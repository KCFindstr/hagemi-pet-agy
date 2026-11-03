import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { diffConversations, Monitor, parseConversations, toolCategory, TranscriptTail } from '../sidecars/pet/lib/monitor.mjs';

const summary = (status, extra = {}) => ({
  status: `CASCADE_RUN_STATUS_${status}`, stepCount: 3, lastModifiedTime: '2026-11-03T08:00:00Z', lastUserInputTime: '2026-11-03T08:00:00Z',
  annotations: { title: 'Fix the bug' }, latestExecutorTerminationReason: 'EXECUTOR_TERMINATION_REASON_NO_TOOL_CALL', ...extra,
});
const parse = map => parseConversations({ trajectorySummaries: map });

test('parseConversations normalizes the server shape', () => {
  const list = parse({
    a: summary('RUNNING'),
    b: summary('IDLE', { trajectoryMetadata: { parentConversationId: 'a' } }),
    c: summary('BUSY', { waitingSteps: [{}] }),
    d: summary('CANCELING'),
  });
  assert.equal(list.get('a').status, 'running');
  assert.equal(list.get('a').title, 'Fix the bug');
  assert.equal(list.get('a').termination, 'NO_TOOL_CALL');
  assert.equal(list.get('b').status, 'idle');
  assert.equal(list.get('b').parentId, 'a');
  assert.equal(list.get('c').waiting, true);
  assert.equal(list.get('d').status, 'running');
});

test('a malformed response is an empty list, not a crash', () => {
  assert.equal(parseConversations(null).size, 0);
  assert.equal(parseConversations({ trajectorySummaries: {} }).size, 0);
});

test('the first poll is only a baseline', () => {
  assert.deepEqual(diffConversations(null, parse({ a: summary('RUNNING') }), Date.now()), []);
});

test('turns start and end', () => {
  const idle = parse({ a: summary('IDLE') }), running = parse({ a: summary('RUNNING', { stepCount: 3 }) });
  const finished = parse({ a: summary('IDLE', { stepCount: 9 }) });
  assert.deepEqual(diffConversations(idle, running, 0).map(e => e.type), ['turn_start']);
  const [end] = diffConversations(running, finished, 0);
  assert.equal(end.type, 'turn_end');
  assert.equal(end.steps, 6);
});

test('a brand new running conversation counts as a start', () => {
  const [event] = diffConversations(parse({}), parse({ a: summary('RUNNING') }), 0);
  assert.equal(event.type, 'turn_start');
  assert.equal(event.fresh, true);
});

test('subagents report separately from turns', () => {
  const child = status => summary(status, { trajectoryMetadata: { parentConversationId: 'a' } });
  const types = (before, after) => diffConversations(parse(before), parse(after), 0).map(e => e.type);
  assert.deepEqual(types({ a: summary('RUNNING') }, { a: summary('RUNNING'), s: child('RUNNING') }), ['subagent_start']);
  assert.deepEqual(types({ a: summary('RUNNING'), s: child('RUNNING') }, { a: summary('RUNNING'), s: child('IDLE') }), ['subagent_done']);
});

test('tools map to what she should be doing', () => {
  assert.equal(toolCategory('read_file'), 'reading');
  assert.equal(toolCategory('edit_file'), 'writing');
  assert.equal(toolCategory('run_command'), 'running');
  assert.equal(toolCategory('search_web'), 'searching');
  assert.equal(toolCategory('generate_image'), 'drawing');
  assert.equal(toolCategory('invoke_subagent'), 'delegating');
  assert.equal(toolCategory('manage_task'), null);
  // Unknown tools are guessed from their name rather than ignored.
  assert.equal(toolCategory('browser_click_thing'), 'searching');
  assert.equal(toolCategory('call_mcp_tool'), 'running');
});

const step = fields => `${JSON.stringify({ status: 'DONE', created_at: '2026-11-03T08:00:00Z', ...fields })}\n`;

test('the transcript tail reports only what is new', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'hagemi-')), 'transcript.jsonl');
  writeFileSync(file, step({ type: 'USER_INPUT', content: '<USER_REQUEST>\nfix it\n</USER_REQUEST>\n<ADDITIONAL_METADATA>x</ADDITIONAL_METADATA>' }));
  const tail = new TranscriptTail(file);
  assert.deepEqual(await tail.read(), [], 'catching up on the first read reports nothing');
  assert.equal(tail.lastUserText, 'fix it');

  appendFileSync(file, step({ type: 'PLANNER_RESPONSE', input_tokens: 1200, tool_calls: [{ name: 'read_file' }, { name: 'manage_task' }] }));
  const events = await tail.read();
  assert.deepEqual(events.map(e => e.name), ['read_file']);
  assert.equal(tail.toolCount, 1);
  assert.equal(tail.inputTokens, 1200);

  appendFileSync(file, step({ type: 'GENERIC', source: 'MODEL', content: 'all done' }));
  await tail.read();
  assert.equal(tail.lastAgentText, 'all done');

  appendFileSync(file, step({ type: 'ERROR_MESSAGE', status: 'ERROR' }));
  assert.deepEqual((await tail.read()).map(e => e.type), ['step_error']);
  assert.equal(tail.errors, 1);
  assert.deepEqual(await tail.read(), []);
});

test('a turn that started after she arrived reports from its first step', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'hagemi-')), 'transcript.jsonl');
  const old = { created_at: '2026-11-03T07:00:00Z' }, fresh = { created_at: '2026-11-03T08:00:00Z' };
  writeFileSync(file, step({ type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'read_file' }], ...old }) + step({ type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'run_command' }], ...fresh }));
  const tail = new TranscriptTail(file, Date.parse('2026-11-03T07:59:00Z'));
  assert.deepEqual((await tail.read()).map(e => e.name), ['run_command']);
});

test('a half-written line waits for the rest of itself', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'hagemi-')), 'transcript.jsonl');
  writeFileSync(file, step({ type: 'GENERIC', source: 'SYSTEM' }));
  const tail = new TranscriptTail(file);
  await tail.read();
  const line = step({ type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'run_command' }] });
  appendFileSync(file, line.slice(0, 20));
  assert.deepEqual(await tail.read(), []);
  appendFileSync(file, line.slice(20));
  assert.deepEqual((await tail.read()).map(e => e.name), ['run_command']);
});

test('a missing transcript is quiet', async () => {
  assert.deepEqual(await new TranscriptTail(join(tmpdir(), 'hagemi-does-not-exist.jsonl')).read(), []);
});

test('the monitor reports facts from a poll', async () => {
  let now = 1_000_000;
  const events = [];
  const responses = [
    { trajectorySummaries: { a: summary('IDLE') } },
    { trajectorySummaries: { a: summary('RUNNING'), s: summary('RUNNING', { trajectoryMetadata: { parentConversationId: 'a' } }) } },
  ];
  const fakeTail = { read: async () => [{ type: 'tool', name: 'edit_file', category: 'writing' }], toolCount: 1, inputTokens: 0, lastTool: 'edit_file' };
  const monitor = new Monitor({ ls: { call: async () => responses.shift() }, brainDir: tmpdir(), onEvent: e => events.push(e), now: () => now, tailFactory: () => fakeTail });
  await monitor.poll();
  now += 2500;
  await monitor.poll();
  const facts = monitor.facts();
  assert.equal(facts.running, 1);
  assert.equal(facts.subagents, 1);
  assert.equal(facts.category, 'writing');
  assert.ok(events.some(e => e.type === 'turn_start'));
  assert.ok(events.some(e => e.type === 'subagent_start'));
  // A tool category goes stale so a long model turn reads as thinking again.
  now += 20000;
  assert.equal(monitor.facts().category, null);
});

test('waiting on the user shows up in the facts', async () => {
  const response = { trajectorySummaries: { a: summary('RUNNING', { waitingSteps: [{}] }) } };
  const monitor = new Monitor({ ls: { call: async () => response }, brainDir: tmpdir(), onEvent() {}, tailFactory: () => ({ read: async () => [] }) });
  await monitor.poll();
  assert.equal(monitor.facts().waiting, true);
});
