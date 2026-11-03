import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Brain, Budget, ModelResolver } from '../sidecars/pet/lib/brain.mjs';
import { DEFAULTS, sanitize } from '../sidecars/pet/lib/settings.mjs';

function harness(overrides = {}) {
  let now = Date.parse('2026-11-03T12:00:00Z');
  const said = [], calls = [];
  const ls = {
    call: async (method, body) => {
      if (method === 'GetCascadeModelConfigData') return { clientModelConfigs: [
        { label: 'Gemini 3.8 Flash (High)', modelOrAlias: { model: 'MODEL_HIGH' }, quotaInfo: { remainingFraction: 1 } },
        { label: 'Gemini 3.8 Flash (Low)', modelOrAlias: { model: 'MODEL_LOW' }, quotaInfo: { remainingFraction: overrides.modelQuota ?? 1 } },
        { label: 'Claude Opus 5.5 (Low)', modelOrAlias: { model: 'MODEL_CLAUDE' }, quotaInfo: { remainingFraction: 1 } },
      ] };
      calls.push({ method, body });
      if (overrides.fail) throw new Error('offline');
      return { response: overrides.reply ?? 'smug|Extremely well done, nya.' };
    },
  };
  const settings = { value: sanitize({ ...overrides.settings, ai: { ...DEFAULTS.ai, ...overrides.settings?.ai } }) };
  const presence = { visible: true, focused: true, ...overrides.presence };
  const budget = new Budget(null, () => now);
  const brain = new Brain({
    ls, budget, models: new ModelResolver(ls), now: () => now, random: () => 0,
    getSettings: () => settings.value, getLanguage: () => overrides.language || 'en', getPresence: () => presence,
    getQuotaLevel: () => overrides.quotaLevel ?? 0.9, say: (result, trigger) => said.push({ ...result, trigger }),
  });
  return { brain, said, calls, budget, settings, advance: minutes => { now += minutes * 60000; } };
}
const context = { running: 1, title: 'Refactor', toolCount: 9 };
const modelCalls = calls => calls.filter(c => c.method === 'GetModelResponse');

test('a salient moment gets a model comment with the chosen model', async () => {
  const { brain, said, calls } = harness();
  const result = await brain.consider('turn_done_big', context);
  assert.equal(result.ai, true);
  assert.equal(result.text, 'Extremely well done, nya.');
  assert.equal(result.mood, 'smug');
  assert.equal(said.length, 1);
  assert.equal(modelCalls(calls)[0].body.model, 'MODEL_LOW', 'defaults to Gemini 3.8 Flash (Low)');
});

test('ordinary moments never spend tokens', async () => {
  const { brain, calls, said } = harness();
  await brain.consider('turn_done', context);
  assert.equal(modelCalls(calls).length, 0);
  assert.equal(said[0].ai, false);
});

test('turning AI off means scripted lines only', async () => {
  const { brain, calls, said } = harness({ settings: { ai: { enabled: false } } });
  await brain.consider('turn_done_big', { ...context, vars: { count: 9 } });
  assert.equal(modelCalls(calls).length, 0);
  assert.equal(said[0].ai, false);
  assert.ok(said[0].text.length > 0);
});

test('nobody watching, no tokens', async () => {
  const { brain, calls } = harness({ presence: { focused: false } });
  await brain.consider('turn_done_big', context);
  assert.equal(modelCalls(calls).length, 0);
});

test('low quota stops the model, from the bucket or the model itself', async () => {
  for (const options of [{ quotaLevel: 0.1 }, { modelQuota: 0.05 }]) {
    const { brain, calls, said } = harness(options);
    await brain.consider('turn_done_big', context);
    assert.equal(modelCalls(calls).length, 0);
    assert.equal(said[0].ai, false);
  }
});

test('the minimum interval spaces out model calls', async () => {
  const { brain, calls, advance } = harness();
  await brain.consider('turn_done_big', { ...context, title: 'one' });
  advance(3);
  await brain.consider('turn_done_big', { ...context, title: 'two' });
  assert.equal(modelCalls(calls).length, 1);
  advance(10);
  await brain.consider('turn_done_big', { ...context, title: 'three' });
  assert.equal(modelCalls(calls).length, 2);
});

test('hourly and daily caps hold', async () => {
  const { brain, calls, advance } = harness({ settings: { ai: { minIntervalMin: 1, maxPerHour: 2, maxPerDay: 3 } } });
  for (let i = 0; i < 4; i++) { await brain.consider('turn_done_big', { ...context, title: `a${i}` }); advance(2); }
  assert.equal(modelCalls(calls).length, 2, 'hourly cap');
  advance(70);
  for (let i = 0; i < 4; i++) { await brain.consider('turn_done_big', { ...context, title: `b${i}` }); advance(2); }
  assert.equal(modelCalls(calls).length, 3, 'daily cap');
});

test('the token budget holds', async () => {
  const { brain, calls } = harness({ settings: { ai: { dailyTokenBudget: 50 } } });
  await brain.consider('turn_done_big', context);
  assert.equal(modelCalls(calls).length, 0);
});

test('the same situation is not asked about twice', async () => {
  const { brain, calls, advance } = harness();
  await brain.consider('turn_done_big', context);
  advance(20);
  await brain.consider('turn_done_big', context);
  assert.equal(modelCalls(calls).length, 1);
});

test('failures fall back to a scripted line and back off', async () => {
  const { brain, calls, said, advance } = harness({ fail: true });
  const first = await brain.consider('turn_done_big', { ...context, title: 'a' });
  assert.equal(first.ai, false);
  assert.equal(said.length, 1);
  advance(1);
  await brain.consider('turn_done_big', { ...context, title: 'b' });
  assert.equal(modelCalls(calls).length, 1, 'still backing off');
  advance(3);
  await brain.consider('turn_done_big', { ...context, title: 'c' });
  assert.equal(modelCalls(calls).length, 2);
});

test('she does not talk over herself', async () => {
  const { brain, said, advance } = harness({ settings: { ai: { enabled: false } } });
  await brain.consider('turn_done', context);
  advance(0.5);
  await brain.consider('subagent_done', context);
  assert.equal(said.length, 1, 'inside the bubble gap');
  await brain.consider('quota_critical', { vars: { left: '5%' } });
  assert.equal(said.length, 2, 'urgent moments go through');
});

test('chattiness moves the bar', async () => {
  const quiet = harness({ settings: { chattiness: 'quiet', ai: { enabled: false } } });
  await quiet.brain.consider('turn_done', context);
  assert.equal(quiet.said.length, 0);
  const chatty = harness({ settings: { chattiness: 'chatty', ai: { enabled: false } } });
  await chatty.brain.consider('turn_start', context);
  assert.equal(chatty.said.length, 1);
});

test('a forced remark (double-click) still respects the budget', async () => {
  const { brain, calls, said } = harness({ settings: { ai: { dailyTokenBudget: 10 } } });
  await brain.consider('talk', context, { force: true, line: 'talk_offline' });
  assert.equal(modelCalls(calls).length, 0);
  assert.equal(said[0].ai, false);
});

test('the prompt carries the persona and scrubbed context, within a sane size', async () => {
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
  const { brain, calls } = harness();
  await brain.consider('turn_error', { ...context, userText: `use ${secret} please ${'x'.repeat(4000)}`, agentText: '```js\nconst password = 1;\n```' });
  const { prompt } = modelCalls(calls)[0].body;
  assert.match(prompt, /Hagemi/);
  assert.ok(!prompt.includes(secret));
  assert.ok(!prompt.includes('password'));
  assert.ok(prompt.length < 2600, `prompt is ${prompt.length} chars`);
});

test('minimal context withholds titles and excerpts', async () => {
  const { brain, calls } = harness({ settings: { ai: { contextLevel: 'minimal' } } });
  await brain.consider('turn_error', { ...context, title: 'SECRET PROJECT', userText: 'SECRET TEXT', agentText: 'SECRET REPLY' });
  assert.ok(!modelCalls(calls)[0].body.prompt.includes('SECRET'));
});

test('Chinese remarks ask for Chinese', async () => {
  const { brain, calls } = harness({ language: 'zhs', reply: 'smug|本喵极其厉害喵。' });
  const result = await brain.consider('turn_done_big', context);
  assert.match(modelCalls(calls)[0].body.prompt, /哈基米/);
  assert.equal(result.text, '本喵极其厉害喵。');
});

test('model names resolve loosely, preferring the cheap variant', async () => {
  const ls = { call: async () => ({ clientModelConfigs: [
    { label: 'Gemini 3.8 Flash (High)', modelOrAlias: { model: 'H' } },
    { label: 'Gemini 3.8 Flash (Low)', modelOrAlias: { model: 'L' } },
  ] }) };
  const models = new ModelResolver(ls);
  await models.refresh();
  assert.equal(models.resolve('gemini 3.8 flash').id, 'L');
  assert.equal(models.resolve('Gemini 3.8 Flash (High)').id, 'H');
  assert.equal(models.resolve('MODEL_RAW').id, 'MODEL_RAW');
  assert.equal(models.resolve('nonexistent'), null);
});
