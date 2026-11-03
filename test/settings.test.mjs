import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULTS, sanitize, SettingsStore } from '../sidecars/pet/lib/settings.mjs';

test('defaults match the promises in the README', () => {
  assert.equal(DEFAULTS.ai.model, 'Gemini 3.8 Flash (Low)');
  assert.equal(DEFAULTS.language, 'auto');
  assert.equal(DEFAULTS.ai.enabled, true);
});

test('junk input cannot break her', () => {
  const value = sanitize({ language: 'klingon', size: 99, ai: { maxPerDay: 'lots', minIntervalMin: -5, contextLevel: 'everything', model: 42 }, quota: { lowAt: 7 }, position: { x: 'a' } });
  assert.equal(value.language, 'auto');
  assert.equal(value.size, 'm');
  assert.equal(value.ai.maxPerDay, DEFAULTS.ai.maxPerDay);
  assert.equal(value.ai.minIntervalMin, 1);
  assert.equal(value.ai.contextLevel, DEFAULTS.ai.contextLevel);
  assert.equal(value.ai.model, DEFAULTS.ai.model);
  assert.equal(value.quota.lowAt, 0.9);
  assert.equal(value.position, null);
});

test('saved settings survive a restart, and patches merge', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'hagemi-')), 'settings.json');
  const store = new SettingsStore(file);
  store.patch({ language: 'zhs', ai: { maxPerHour: 2 } });
  store.patch({ size: 'l', position: { x: 0.2, y: 0.4 } });
  const reloaded = new SettingsStore(file);
  assert.equal(reloaded.value.language, 'zhs');
  assert.equal(reloaded.value.size, 'l');
  assert.equal(reloaded.value.ai.maxPerHour, 2);
  assert.equal(reloaded.value.ai.model, DEFAULTS.ai.model);
  assert.deepEqual(reloaded.value.position, { x: 0.2, y: 0.4 });
  assert.ok(JSON.parse(readFileSync(file, 'utf8')));
});

test('a corrupt settings file falls back to defaults', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'hagemi-')), 'settings.json');
  writeFileSync(file, '{ not json');
  assert.equal(new SettingsStore(file).value.language, 'auto');
});

test('docking is remembered with the position', () => {
  const value = sanitize({ position: { x: 0, y: 0.5, dock: 'left' } });
  assert.equal(value.position.dock, 'left');
  assert.equal(sanitize({ position: { x: 0, y: 0.5, dock: 'sideways' } }).position.dock, undefined);
});
