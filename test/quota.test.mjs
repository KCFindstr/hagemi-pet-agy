import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bucketsForModel, formatDuration, isResetSoon, moodFor, parseQuota, quotaEvents, summarize } from '../sidecars/pet/lib/quota.mjs';

const NOW = Date.parse('2026-11-03T08:00:00Z');
const inMinutes = minutes => new Date(NOW + minutes * 60000).toISOString();
const response = (gemini5h = 1, weekly = 0.8, reset = 180) => ({
  response: {
    groups: [
      { displayName: 'Gemini Models', buckets: [{ bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: weekly, resetTime: inMinutes(5000) }, { bucketId: 'gemini-5h', window: '5h', remainingFraction: gemini5h, resetTime: inMinutes(reset) }] },
      { displayName: 'Claude and GPT models', buckets: [{ bucketId: '3p-5h', window: '5h', remainingFraction: 0.05, resetTime: inMinutes(60) }] },
      { displayName: 'Gemini 4 Argon', buckets: [{ bucketId: 'gemini-argon-wtu-weekly', window: 'weekly', remainingFraction: 0.5, resetTime: inMinutes(5000) }] },
    ],
  },
});

test('parses buckets, tolerating junk values', () => {
  const buckets = parseQuota({ groups: [{ displayName: 'x', buckets: [{ bucketId: 'x-5h', remainingFraction: 'nope' }, { bucketId: 'y-weekly', remainingFraction: 1.4, resetTime: 'garbage' }] }] }, NOW);
  assert.equal(buckets[0].remaining, null);
  assert.equal(buckets[0].window, '5h');
  assert.equal(buckets[1].remaining, 1);
  assert.equal(buckets[1].resetAt, null);
  assert.deepEqual(parseQuota(null, NOW), []);
});

test('a model only draws from its own family of buckets', () => {
  const buckets = parseQuota(response(), NOW);
  assert.deepEqual(bucketsForModel(buckets, 'Gemini 3.8 Flash (Low)').map(b => b.id), ['gemini-weekly', 'gemini-5h']);
  assert.deepEqual(bucketsForModel(buckets, 'Claude Opus 5.5 (High)').map(b => b.id), ['3p-5h']);
  assert.deepEqual(bucketsForModel(buckets, 'Gemini 4 Argon (Medium)').map(b => b.id), ['gemini-argon-wtu-weekly']);
});

test('the lowest bucket decides her mood', () => {
  const summary = summarize(parseQuota(response(0.2, 0.8), NOW), 'Gemini 3.8 Flash', {}, NOW);
  assert.equal(summary.level, 0.2);
  assert.equal(summary.mood, 'low');
  assert.equal(summary.limiting.id, 'gemini-5h');
});

test('mood thresholds', () => {
  assert.equal(moodFor(null), 'ok');
  assert.equal(moodFor(0.6), 'ok');
  assert.equal(moodFor(0.25), 'low');
  assert.equal(moodFor(0.09), 'critical');
  assert.equal(moodFor(0), 'empty');
  assert.equal(moodFor(0.3, { lowAt: 0.4 }), 'low');
});

const sum = (level, reset = 180) => summarize(parseQuota(response(level, 1, reset), NOW), 'Gemini', {}, NOW);
const types = (a, b) => quotaEvents(a, b).map(e => e.type);

test('falling through a threshold is an event, staying below is not', () => {
  assert.deepEqual(types(sum(0.5), sum(0.2)), ['quota_low']);
  assert.deepEqual(types(sum(0.2), sum(0.18)), []);
  assert.deepEqual(types(sum(0.2), sum(0.05)), ['quota_critical']);
  assert.deepEqual(types(sum(0.05), sum(0)), ['quota_empty']);
});

test('the jar refilling is noticed', () => {
  const [event] = quotaEvents(sum(0.05), sum(1));
  assert.equal(event.type, 'quota_refilled');
  assert.equal(event.wasEmpty, true);
  assert.deepEqual(types(sum(0.5), sum(0.55)), [], 'small drifts are not a refill');
});

test('a reset coming up only matters when she is short on honey', () => {
  assert.deepEqual(types(sum(0.3, 60), sum(0.3, 15)), ['reset_soon']);
  assert.deepEqual(types(sum(0.3, 15), sum(0.3, 14)), []);
  assert.deepEqual(types(sum(0.9, 60), sum(0.9, 15)), []);
  assert.equal(isResetSoon(sum(0.3, 15)), true);
  assert.equal(isResetSoon(sum(0.9, 15)), false);
});

test('first reading is a baseline', () => {
  assert.deepEqual(quotaEvents(null, sum(0.05)), []);
});

test('durations read naturally in both languages', () => {
  assert.equal(formatDuration(30000), '<1m');
  assert.equal(formatDuration(45 * 60000), '45m');
  assert.equal(formatDuration(3 * 3600000 + 12 * 60000), '3h 12m');
  assert.equal(formatDuration(52 * 3600000), '2d 4h');
  assert.equal(formatDuration(45 * 60000, 'zhs'), '45 分钟');
  assert.equal(formatDuration(null), '—');
});
