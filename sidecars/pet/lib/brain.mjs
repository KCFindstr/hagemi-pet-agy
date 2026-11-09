// Decides whether she says anything, and whether it is worth spending tokens on.
// Most moments get a scripted line for free. A model call must clear every one of these:
//   the moment is salient enough, she is allowed to use AI at all, someone is looking at the window,
//   the cooldown has passed, the hourly and daily caps and the token budget have room, quota is
//   not low, nothing is already in flight, and this exact situation has not been asked before.
// Input is capped, excerpts are scrubbed, and any failure falls back to the scripted line.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pickLine } from './lines.mjs';
import { buildPrompt, estimateTokens, parseReply, scrub } from './persona.mjs';
import { CHATTINESS, REACTIONS } from './director.mjs';

const MINUTE = 60000, HOUR = 3600000;
const FAILURE_BACKOFF_MS = [2, 5, 15, 30, 60].map(minutes => minutes * MINUTE);

const dayKey = now => {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export class Budget {
  constructor(file, now = Date.now) {
    this.file = file;
    this.now = now;
    this.state = { day: dayKey(now()), calls: 0, tokens: 0, recent: [], lastCallAt: 0 };
    if (file) {
      try { Object.assign(this.state, JSON.parse(readFileSync(file, 'utf8'))); } catch { /* First run. */ }
    }
    this.rollover();
  }
  rollover() {
    const today = dayKey(this.now());
    if (this.state.day !== today) Object.assign(this.state, { day: today, calls: 0, tokens: 0 });
    this.state.recent = this.state.recent.filter(at => this.now() - at < HOUR);
  }
  // Why a call may not happen right now, or null when it may.
  refuse(ai, estimate) {
    this.rollover();
    const { state } = this;
    if (this.now() - state.lastCallAt < ai.minIntervalMin * MINUTE) return 'interval';
    if (state.recent.length >= ai.maxPerHour) return 'hourly';
    if (state.calls >= ai.maxPerDay) return 'daily';
    if (state.tokens + estimate > ai.dailyTokenBudget) return 'tokens';
    return null;
  }
  record(tokens) {
    this.rollover();
    const { state } = this;
    state.calls++;
    state.tokens += tokens;
    state.recent.push(this.now());
    state.lastCallAt = this.now();
    this.save();
  }
  save() {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.state));
    } catch { /* Losing today's tally only makes her a little more talkative. */ }
  }
  get usage() { this.rollover(); return { calls: this.state.calls, tokens: this.state.tokens }; }
}

export class ModelResolver {
  constructor(ls) { this.ls = ls; this.configs = []; this.fetchedAt = 0; }
  async refresh(force = false) {
    if (!force && Date.now() - this.fetchedAt < 10 * MINUTE && this.configs.length) return this.configs;
    const response = await this.ls.call('GetCascadeModelConfigData');
    this.configs = (response.clientModelConfigs || []).filter(c => c.modelOrAlias?.model).map(c => ({
      label: c.label, id: c.modelOrAlias.model,
      remaining: c.quotaInfo?.remainingFraction == null ? null : Number(c.quotaInfo.remainingFraction),
    }));
    this.fetchedAt = Date.now();
    return this.configs;
  }
  // Accepts an exact label, a raw MODEL_* id, or a loose name like "gemini 3.8 flash".
  resolve(wanted) {
    if (/^MODEL_/.test(wanted)) return this.configs.find(c => c.id === wanted) || { label: wanted, id: wanted, remaining: null };
    const lower = wanted.toLowerCase();
    const exact = this.configs.find(c => c.label?.toLowerCase() === lower);
    if (exact) return exact;
    const loose = this.configs.filter(c => c.label?.toLowerCase().includes(lower));
    return loose.find(c => /\(low\)/i.test(c.label)) || loose[0] || null;
  }
  labelOf(id) { return this.configs.find(c => c.id === id)?.label || null; }
}

export class Brain {
  constructor({ ls, budget, models, getSettings, getLanguage, getPresence, getQuotaLevel, now = Date.now, random = Math.random, say, log = () => {} }) {
    Object.assign(this, { ls, budget, models, getSettings, getLanguage, getPresence, getQuotaLevel, now, random, say, log });
    this.lastTrigger = new Map();
    this.lastBubbleAt = 0;
    this.inFlight = false;
    this.failures = 0;
    this.retryAt = 0;
    this.seen = new Map();
    this.recent = [];
  }

  // Why the model should not be used for this moment, or null to go ahead.
  aiBlocked(trigger, reaction, forced = false) {
    const { ai, chattiness } = this.getSettings();
    if (!ai.enabled) return 'disabled';
    if (!forced && !reaction.ai) return 'not-worth-it';
    if (!forced && reaction.salience < (CHATTINESS[chattiness] || CHATTINESS.normal).aiFloor) return 'not-salient';
    if (this.inFlight) return 'in-flight';
    if (this.now() < this.retryAt) return 'backoff';
    const presence = this.getPresence();
    if (ai.onlyWhenFocused && !(presence.visible && presence.focused)) return 'unfocused';
    const level = this.getQuotaLevel();
    if (level != null && level <= ai.pauseBelowQuota) return 'low-quota';
    return null;
  }

  describe(trigger, context, language) {
    const zh = language === 'zhs';
    const { ai } = this.getSettings();
    const situations = {
      turn_done_big: zh ? '一个大任务刚刚完成' : 'A big agent task just finished',
      turn_error: zh ? '代理任务刚刚出错结束' : 'An agent task just ended in an error',
      long_run: zh ? '代理已经运行很久了' : 'The agent has been running for a long time',
      subagent_many: zh ? '同时运行着很多子代理（你的小分身）' : 'Many subagents (your tiny clones) are running at once',
      swamped: zh ? '用户同时开了很多会话' : 'The user has many sessions running at once',
      context_big: zh ? '当前对话的上下文非常大' : 'The current conversation context has grown huge',
      model_rival_claude: zh ? '用户刚把模型切成了 Claude' : 'The user just switched the model to Claude',
      model_rival_gpt: zh ? '用户刚把模型切成了 GPT' : 'The user just switched the model to GPT',
      quota_critical: zh ? '额度（你的小鱼干）快用完了' : 'Quota (your dried fish) is almost gone',
      reset_soon: zh ? '额度快要重置了，小鱼干马上回来' : 'Quota is about to reset; the dried fish return soon',
      late_night: zh ? '深夜了，用户还在工作' : 'It is very late and the user is still working',
      long_session: zh ? '用户已经连续工作很久了' : 'The user has been working for a long stretch',
      idle_ponder: zh ? '现在没什么事，随口说点什么' : 'Nothing much is happening; muse about something',
      talk: zh ? '用户双击了你，想听你说话' : 'The user double-clicked you and wants to hear from you',
    };
    const facts = [];
    const date = new Date(this.now());
    facts.push(`${zh ? '现在' : 'Time'}: ${date.toLocaleString(zh ? 'zh-CN' : 'en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`);
    if (context.running != null) facts.push(`${zh ? '运行中的会话' : 'Running sessions'}: ${context.running}, ${zh ? '子代理' : 'subagents'}: ${context.subagents || 0}`);
    if (context.lastTool) facts.push(`${zh ? '最近的工具' : 'Last tool'}: ${context.lastTool}`);
    if (context.toolCount) facts.push(`${zh ? '工具调用次数' : 'Tool calls'}: ${context.toolCount}`);
    if (context.durationMin) facts.push(`${zh ? '耗时（分钟）' : 'Duration (min)'}: ${context.durationMin}`);
    if (context.quotaPercent != null) facts.push(`${zh ? '额度剩余' : 'Quota left'}: ${context.quotaPercent}%`);
    if (context.model) facts.push(`${zh ? '用户选的模型' : 'Selected model'}: ${context.model}`);
    if (ai.contextLevel !== 'minimal' && context.title) facts.push(`${zh ? '对话标题' : 'Chat title'}: ${scrub(context.title, 70)}`);
    if (ai.contextLevel === 'snippets') {
      if (context.userText) facts.push(`${zh ? '用户说' : 'User said'}: ${scrub(context.userText, 200)}`);
      if (context.agentText) facts.push(`${zh ? '代理说' : 'Agent said'}: ${scrub(context.agentText, 1000)}`);
    }
    return { situation: situations[trigger] || trigger, facts };
  }

  async generate(trigger, context, language) {
    const { ai } = this.getSettings();
    await this.models.refresh().catch(() => {});
    const model = this.models.resolve(ai.model);
    if (!model) return null;
    if (model.remaining != null && model.remaining <= ai.pauseBelowQuota) return null;
    const { situation, facts } = this.describe(trigger, context, language);
    const prompt = buildPrompt({ language, situation, facts, recent: this.recent.slice(-2), personaExtra: ai.personaExtra });
    const key = createHash('sha1').update(`${language}|${situation}|${facts.slice(1).join('|')}`).digest('hex');
    if (this.seen.has(key) && this.now() - this.seen.get(key) < 6 * HOUR) return null;
    const replyAllowance = language === 'zhs' ? 60 : 50;
    const estimate = estimateTokens(prompt) + replyAllowance;
    const refused = this.budget.refuse(ai, estimate);
    if (refused) { this.log(`ai skipped: ${refused}`); return null; }
    this.inFlight = true;
    this.seen.set(key, this.now());
    if (this.seen.size > 200) this.seen.delete(this.seen.keys().next().value);
    try {
      const response = await this.ls.call('GetModelResponse', { prompt, model: model.id }, 30000);
      const parsed = parseReply(response.response, language);
      this.budget.record(estimateTokens(prompt) + estimateTokens(response.response || ''));
      this.failures = 0;
      return parsed;
    } catch (error) {
      this.retryAt = this.now() + FAILURE_BACKOFF_MS[Math.min(this.failures, FAILURE_BACKOFF_MS.length - 1)];
      this.failures++;
      this.log(`ai failed: ${error.message}`);
      return null;
    } finally {
      this.inFlight = false;
    }
  }

  async consider(trigger, context = {}, { force = false, line = null } = {}) {
    const reaction = REACTIONS[trigger] || { salience: 0.5 };
    const settings = this.getSettings();
    const now = this.now();
    const talkMode = settings.chattiness in CHATTINESS ? CHATTINESS[settings.chattiness] : CHATTINESS.normal;
    const cooldown = (reaction.cooldownMin ?? 5) * MINUTE;
    if (!force) {
      if (now - (this.lastTrigger.get(trigger) || -Infinity) < cooldown) return null;
      if (reaction.salience < talkMode.floor) return null;
      if (!reaction.urgent && now - this.lastBubbleAt < talkMode.gapSec * 1000) return null;
    }
    this.lastTrigger.set(trigger, now);
    const language = this.getLanguage();
    const scriptKey = line || trigger;
    const canned = pickLine(language, scriptKey, context.vars);
    this.lastBubbleAt = now;
    let result = null;
    const blocked = this.aiBlocked(trigger, reaction, force);
    if (!blocked) {
      const reply = await this.generate(trigger, context, language);
      if (reply) {
        this.recent.push(reply.line);
        if (this.recent.length > 4) this.recent.shift();
        result = { text: reply.line, mood: reply.mood, ai: true };
      }
    }
    if (!result && canned) result = { ...canned, ai: false };
    if (!result) return null;
    this.lastBubbleAt = this.now();
    this.say(result, trigger);
    return result;
  }
}
