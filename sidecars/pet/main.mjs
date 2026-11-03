// Sidecar entry point: watches Antigravity, decides how she feels, and tells the pet.
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Brain, Budget, ModelResolver } from './lib/brain.mjs';
import { RendererBridge } from './lib/cdp.mjs';
import { ambientTriggers, chooseState, classifyTurnEnd, festival, isLate, modelFamily, REACTIONS, timeOfDay } from './lib/director.mjs';
import { fill, resolveLanguage, UI } from './lib/lines.mjs';
import { LanguageServer } from './lib/ls-client.mjs';
import { Monitor } from './lib/monitor.mjs';
import { formatDuration, isResetSoon, parseQuota, quotaEvents, summarize } from './lib/quota.mjs';
import { readArt } from './lib/renderer-source.mjs';
import { SettingsStore } from './lib/settings.mjs';

const MINUTE = 60000;
const log = message => console.log(`[hagemi] ${message}`);

const geminiDir = process.env.ANTIGRAVITY_GEMINI_DIR || join(homedir(), '.gemini');
const appDataDir = resolve(geminiDir, process.env.ANTIGRAVITY_APP_DATA_DIR || 'antigravity');
const dataDir = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || join(appDataDir, 'sidecar_data', 'hagemi-pet-agy', 'pet', 'data');

// The host starts sidecars inside the plugin folder, and on Windows the current directory of a
// running process cannot be removed. Move out so the plugin can be updated or uninstalled.
try { mkdirSync(dataDir, { recursive: true }); process.chdir(dataDir); } catch { /* Stays put; only updates are affected. */ }

const settings = new SettingsStore(join(dataDir, 'settings.json'));
const budget = new Budget(join(dataDir, 'budget.json'));
const ls = new LanguageServer();
const models = new ModelResolver(ls);

let appLanguage = 'en';
let facts = { running: 0, subagents: 0, category: null, idleMs: 0, quietMs: 0, connected: false };
let quota = { level: null, mood: 'ok', buckets: [], resetInMs: null };
let presence = { visible: true, focused: true, idleMs: 0 };
let selectedModel = null;
let activeSince = null, lastToolAt = 0;
let lastFactsJson = '', lastLoggedState = null, lastState = null;

const language = () => resolveLanguage(settings.value.language, appLanguage);
const ui = () => UI[language()];
const quotaOptions = () => ({ lowAt: settings.value.quota.lowAt, criticalAt: settings.value.quota.criticalAt, resetSoonMs: settings.value.quota.resetSoonMin * MINUTE });

const bridge = new RendererBridge({ onMessage: onPetMessage, log });
const brain = new Brain({
  ls, budget, models, log,
  getSettings: () => settings.value,
  getLanguage: language,
  getPresence: () => presence,
  getQuotaLevel: () => quota.level,
  say: (result, trigger) => {
    bridge.broadcast({ t: 'say', text: result.text, mood: result.mood, ai: result.ai, force: trigger === 'greet' });
    if (process.env.HAGEMI_DEBUG) log(`${trigger}${result.ai ? ' (ai)' : ''}: ${result.text}`);
  },
});

function hudRows() {
  const strings = ui(), rows = [];
  const percent = level => `${Math.round(level * 100)}%`;
  for (const bucket of quota.buckets) {
    const label = bucket.window === '5h' ? strings.hud_5h : bucket.window === 'weekly' ? strings.hud_weekly : bucket.group;
    const reset = bucket.resetAt ? ` · ${formatDuration(bucket.resetAt - Date.now(), language())}` : '';
    rows.push({ label, level: bucket.remaining, value: `${percent(bucket.remaining)}${reset}` });
  }
  rows.push({ label: strings.hud_agents, value: facts.running || facts.subagents ? fill(strings.hud_subagents, facts) : strings.hud_idle });
  const usage = budget.usage;
  if (settings.value.ai.enabled) rows.push({ label: strings.hud_comments, value: `${usage.calls}/${settings.value.ai.maxPerDay} · ~${usage.tokens}` });
  if (!facts.connected) rows.push({ label: 'Antigravity', value: strings.hud_unavailable });
  return rows;
}

function publishFacts(force = false) {
  // She naps when neither the agents nor you have done anything for a while.
  const idleMs = Math.min(facts.idleMs || 0, presence.visible ? presence.idleMs : Infinity);
  const state = chooseState({ ...facts, idleMs }, quota, { resetSoon: isResetSoon(quota, quotaOptions()) });
  if (lastState === 'sleeping' && state !== 'sleeping') moment('wake');
  lastState = state;
  const message = {
    t: 'facts', state, quota: quota.mood === 'empty' ? 'critical' : quota.mood, late: isLate(new Date()),
    subagents: facts.subagents, jarLevel: quota.level, jarLabel: quota.level == null ? '' : `${Math.round(quota.level * 100)}%`, hud: hudRows(),
  };
  const json = JSON.stringify(message);
  if (process.env.HAGEMI_DEBUG && state !== lastLoggedState) {
    lastLoggedState = state;
    log(`state: ${state} (running ${facts.running}, subagents ${facts.subagents}, tool ${facts.lastTool || '-'}, category ${facts.category || '-'})`);
  }
  if (force || json !== lastFactsJson) {
    lastFactsJson = json;
    bridge.broadcast(message);
  } else bridge.broadcast({ t: 'heartbeat' });
}

function act(trigger) {
  const reaction = REACTIONS[trigger]?.react;
  if (reaction) bridge.broadcast({ t: 'react', ...reaction });
}

function context(extra = {}) {
  return {
    running: facts.running, subagents: facts.subagents, lastTool: facts.lastTool, toolCount: facts.toolCount, title: facts.title,
    userText: facts.userText, agentText: facts.agentText, quotaPercent: quota.level == null ? null : Math.round(quota.level * 100), model: selectedModel?.label,
    ...extra,
  };
}

// Say and act together: the reaction plays even when she stays quiet.
function moment(trigger, extra = {}, options = {}) {
  act(trigger);
  brain.consider(trigger, context(extra), options).catch(error => log(`remark failed: ${error.message}`));
}

function onEvent(event) {
  if (process.env.HAGEMI_DEBUG) log(`event: ${event.type}${event.name ? ` ${event.name}` : ''}${event.termination ? ` ${event.termination}` : ''}${event.isSubagent ? ' (subagent)' : ''}`);
  switch (event.type) {
    case 'turn_start':
      if (!activeSince) activeSince = Date.now();
      lastToolAt = Date.now();
      moment('turn_start');
      break;
    case 'turn_end': {
      const trigger = classifyTurnEnd(event);
      moment(trigger, {
        title: event.title, toolCount: event.toolCount, durationMin: Math.round((event.durationMs || 0) / MINUTE),
        userText: event.userText, agentText: event.agentText, vars: { count: event.toolCount || 0 },
      });
      break;
    }
    case 'tool':
      lastToolAt = Date.now();
      if (event.category === 'drawing') moment('drawing');
      break;
    case 'step_error':
      moment('step_error');
      break;
    case 'compact':
      moment('compact');
      break;
    case 'context_big':
      moment('context_big', { title: event.title });
      break;
    case 'subagent_start': {
      const count = facts.subagents + 1;
      moment(count >= 3 ? 'subagent_many' : 'subagent_start', { vars: { count } });
      break;
    }
    case 'subagent_done':
      if (facts.subagents <= 1) moment('subagent_done');
      break;
    default:
      break;
  }
}

let previousRunning = 0, previousWaiting = false;
const monitor = new Monitor({
  ls, brainDir: join(appDataDir, 'brain'), onEvent,
  onFacts(next) {
    const now = Date.now();
    facts = { ...next, quietMs: lastToolAt ? now - lastToolAt : 0 };
    if (next.waiting && !previousWaiting) moment('waiting');
    previousWaiting = next.waiting;
    if (next.running === 2 && previousRunning < 2) moment('busy');
    if (next.running >= 3 && previousRunning < 3) moment('swamped', { vars: { count: next.running } });
    previousRunning = next.running;
    if (next.running || next.subagents) activeSince ||= now;
    else if (next.idleMs > 10 * MINUTE) activeSince = null;
    if (next.longestRunMs > 12 * MINUTE && !monitor.longRunWarned) { monitor.longRunWarned = true; moment('long_run', { durationMin: Math.round(next.longestRunMs / MINUTE) }); }
    if (!next.running) monitor.longRunWarned = false;
    publishFacts();
  },
});
monitor.onError = error => {
  if (facts.connected) log(`monitor: ${error.message}`);
  facts = { ...facts, connected: false };
};

async function pollQuota() {
  try {
    const response = await ls.call('RetrieveUserQuotaSummary');
    const now = Date.now();
    const next = summarize(parseQuota(response, now), selectedModel?.label || 'gemini', quotaOptions(), now);
    for (const event of quotaEvents(quota, next, quotaOptions())) {
      if (event.type === 'quota_ok') continue;
      moment(event.type, { vars: { left: event.type === 'reset_soon' ? formatDuration(event.resetInMs, language()) : `${Math.round(event.level * 100)}%` } });
    }
    quota = next;
    publishFacts();
  } catch (error) { log(`quota: ${error.message}`); }
}

// Which model the user has picked: she has opinions about the competition.
async function pollModel() {
  try {
    const state = await readFile(join(appDataDir, 'antigravity_state.pbtxt'), 'utf8');
    const id = state.match(/last_selected_agent_model:\s*(\S+)/)?.[1];
    if (!id) return;
    await models.refresh();
    const label = models.labelOf(id);
    if (!label) return;
    const next = { id, label, family: modelFamily(label) };
    const previous = selectedModel;
    selectedModel = next;
    if (previous && previous.id !== next.id) {
      if (next.family === 'claude' || next.family === 'gpt') moment(`model_rival_${next.family}`);
      else if (next.family === 'gemini' && previous.family !== 'gemini') moment('model_back');
    }
  } catch { /* The state file format is the app's own; she just goes without opinions. */ }
}

function greet() {
  const now = new Date();
  const fest = festival(now);
  const scene = fest || `greet_${timeOfDay(now)}`;
  bridge.broadcast({ t: 'react', state: scene, ms: 4200, gesture: 'hop', burst: 'sparkles' });
  brain.consider('greet', {}, { line: scene }).catch(() => {});
}

function ambient() {
  for (const trigger of ambientTriggers({
    now: Date.now(), active: facts.running > 0, activeSinceMs: activeSince ? Date.now() - activeSince : 0,
    lastRemarkAgoMs: Date.now() - brain.lastBubbleAt, idleMs: Math.min(facts.idleMs || 0, presence.idleMs || 0),
  })) {
    moment(trigger, { vars: { name: `${new Date().getHours()}:00` } });
    break;
  }
}

let greeted = false;
function onPetMessage(message, session) {
  switch (message.type) {
    case 'ready':
      bridge.post(session, { t: 'hello', settings: settings.value, ui: ui() });
      lastFactsJson = '';
      publishFacts(true);
      sendModelChoices(session);
      if (!greeted) { greeted = true; setTimeout(greet, 900); }
      break;
    case 'art':
      bridge.post(session, { t: 'art', name: message.name, data: readArt(message.name) });
      break;
    case 'settings': {
      const before = settings.value.language;
      settings.patch(message.patch);
      if (settings.value.language !== before) bridge.broadcast({ t: 'settings', settings: settings.value, ui: ui() });
      publishFacts();
      break;
    }
    case 'presence':
      presence = { visible: !!message.visible, focused: !!message.focused, idleMs: Number(message.idleMs) || 0 };
      if (message.language) appLanguage = message.language;
      break;
    case 'remount':
      bridge.remount(session);
      break;
    case 'talk':
      brain.consider('talk', context(), { force: true, line: 'talk_offline' }).catch(() => {});
      break;
    case 'touch': {
      const known = ['poke', 'pet', 'coax', 'annoyed', 'puffed', 'redhot', 'sulk', 'shaken', 'grab'];
      if (known.includes(message.kind)) brain.consider(message.kind, {}).catch(() => {});
      break;
    }
    case 'error':
      log(`pet error: ${String(message.message).slice(0, 400)}`);
      break;
    default:
      break;
  }
}

async function sendModelChoices(session) {
  try {
    const configs = await models.refresh();
    bridge.post(session, { t: 'models', models: configs.map(c => c.label), usage: budget.usage });
  } catch { /* The picker falls back to a free-text field. */ }
}

const timers = [setInterval(pollQuota, 60000), setInterval(pollModel, 20000), setInterval(ambient, 5 * MINUTE)];
for (const timer of timers) timer.unref?.();
pollModel().then(pollQuota);
monitor.start();
bridge.start();
log(`started, data in ${dataDir}`);

// Keep the process alive even when every timer above is unreferenced.
const keepAlive = setInterval(() => {}, 1 << 30);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(keepAlive);
  monitor.stop();
  const force = setTimeout(() => process.exit(0), 2000);
  force.unref?.();
  await bridge.stop();
  process.exit(0);
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, shutdown);
