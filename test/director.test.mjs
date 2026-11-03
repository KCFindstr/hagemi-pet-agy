import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ambientTriggers, chooseState, classifyTurnEnd, festival, isLate, modelFamily, REACTIONS, timeOfDay } from '../sidecars/pet/lib/director.mjs';

const facts = extra => ({ running: 0, subagents: 0, category: null, idleMs: 0, quietMs: 0, ...extra });
const ok = { mood: 'ok' };

test('what she does follows what the agents do', () => {
  assert.equal(chooseState(facts(), ok), 'idle');
  assert.equal(chooseState(facts({ running: 1 }), ok), 'thinking');
  assert.equal(chooseState(facts({ running: 1, quietMs: 40000 }), ok), 'deepthink');
  assert.equal(chooseState(facts({ running: 1, category: 'reading' }), ok), 'reading');
  assert.equal(chooseState(facts({ running: 1, category: 'writing' }), ok), 'writing');
  assert.equal(chooseState(facts({ running: 1, category: 'running' }), ok), 'running');
  assert.equal(chooseState(facts({ running: 1, category: 'searching' }), ok), 'searching');
  assert.equal(chooseState(facts({ running: 1, category: 'drawing' }), ok), 'drawing');
  assert.equal(chooseState(facts({ running: 1, category: 'compacting' }), ok), 'compacting');
  assert.equal(chooseState(facts({ running: 1, subagents: 2 }), ok), 'delegating');
});

test('priority: empty jar beats everything, then waiting, then workload', () => {
  assert.equal(chooseState(facts({ running: 3, waiting: true }), { mood: 'empty' }), 'exhausted');
  assert.equal(chooseState(facts({ running: 3, waiting: true }), ok), 'asking');
  assert.equal(chooseState(facts({ running: 3, category: 'reading' }), ok), 'swamped');
  assert.equal(chooseState(facts({ running: 2, category: 'reading' }), ok), 'busy');
});

test('quota and time shape her downtime', () => {
  assert.equal(chooseState(facts(), { mood: 'critical' }), 'tired');
  assert.equal(chooseState(facts({ running: 1 }), { mood: 'critical' }), 'thinking', 'she still works when low');
  assert.equal(chooseState(facts(), { mood: 'low' }, { resetSoon: true }), 'resetSoon');
  assert.equal(chooseState(facts({ idleMs: 11 * 60000 }), ok), 'sleeping');
  assert.equal(chooseState(facts({ idleMs: 9 * 60000 }), ok), 'idle');
});

test('finished turns get the reaction they deserve', () => {
  assert.equal(classifyTurnEnd({ termination: 'NO_TOOL_CALL', toolCount: 2, durationMs: 1000 }), 'turn_done');
  assert.equal(classifyTurnEnd({ termination: 'NO_TOOL_CALL', toolCount: 9 }), 'turn_done_big');
  assert.equal(classifyTurnEnd({ termination: 'NO_TOOL_CALL', durationMs: 6 * 60000 }), 'turn_done_big');
  assert.equal(classifyTurnEnd({ termination: 'ERROR' }), 'turn_error');
  assert.equal(classifyTurnEnd({ termination: 'USER_CANCELED' }), 'turn_canceled');
  assert.equal(classifyTurnEnd({ termination: 'MAX_INVOCATIONS' }), 'turn_maxed');
  assert.equal(classifyTurnEnd({ termination: 'NO_TOOL_CALL', errors: 3, toolCount: 4 }), 'turn_error');
});

test('time of day windows', () => {
  const at = hour => timeOfDay(new Date(2026, 10, 3, hour));
  assert.equal(at(6), 'morning');
  assert.equal(at(12), 'noon');
  assert.equal(at(15), 'afternoon');
  assert.equal(at(20), 'evening');
  assert.equal(at(23), 'night');
  assert.equal(at(1), 'night');
  assert.equal(at(3), 'dawn');
  assert.equal(isLate(new Date(2026, 10, 3, 2)), true);
  assert.equal(isLate(new Date(2026, 10, 3, 9)), false);
});

test('festivals', () => {
  assert.equal(festival(new Date(2026, 9, 31)), 'fest_halloween');
  assert.equal(festival(new Date(2026, 11, 25)), 'fest_christmas');
  assert.equal(festival(new Date(2027, 0, 1)), 'fest_newyear');
  assert.equal(festival(new Date(2027, 1, 6)), 'fest_spring');
  assert.equal(festival(new Date(2026, 10, 3)), null);
});

test('she can tell the competition apart', () => {
  assert.equal(modelFamily('Claude Opus 5.5 (High)'), 'claude');
  assert.equal(modelFamily('GPT-OSS 120B (Medium)'), 'gpt');
  assert.equal(modelFamily('Gemini 3.8 Flash (Low)'), 'gemini');
  assert.equal(modelFamily('Mystery'), 'other');
});

test('ambient nudges', () => {
  const late = new Date(2026, 10, 3, 2).getTime();
  assert.ok(ambientTriggers({ now: late, active: true, activeSinceMs: 0, lastRemarkAgoMs: 0, idleMs: 0 }).includes('late_night'));
  assert.deepEqual(ambientTriggers({ now: late, active: false, activeSinceMs: 0, lastRemarkAgoMs: 0, idleMs: 0 }), []);
  const noon = new Date(2026, 10, 3, 12).getTime();
  assert.ok(ambientTriggers({ now: noon, active: true, activeSinceMs: 3 * 3600000, lastRemarkAgoMs: 0, idleMs: 0 }).includes('long_session'));
  assert.ok(ambientTriggers({ now: noon, active: false, activeSinceMs: 0, lastRemarkAgoMs: 40 * 60000, idleMs: 0 }).includes('idle_ponder'));
  assert.deepEqual(ambientTriggers({ now: noon, active: false, activeSinceMs: 0, lastRemarkAgoMs: 40 * 60000, idleMs: 20 * 60000 }), [], 'nobody home, nothing to say');
});

test('every reaction names a real salience', () => {
  for (const [name, reaction] of Object.entries(REACTIONS)) assert.ok(reaction.salience >= 0 && reaction.salience <= 1, name);
});
