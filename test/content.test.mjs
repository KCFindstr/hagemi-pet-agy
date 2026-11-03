// Keeps the pieces honest with each other: lines, states, art and landmarks.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { isAppWindow, profileDirectory } from '../sidecars/pet/lib/cdp.mjs';
import { REACTIONS } from '../sidecars/pet/lib/director.mjs';
import { fill, LINES, pickLine, resolveLanguage, UI } from '../sidecars/pet/lib/lines.mjs';
import { readArt, rendererSource } from '../sidecars/pet/lib/renderer-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART = join(ROOT, 'sidecars', 'pet', 'art');
const rig = JSON.parse(readFileSync(join(ART, 'rig.json'), 'utf8'));

function loadBehavior() {
  const context = { HAGEMI: {}, performance: { now: () => 0 }, Math };
  vm.createContext(context);
  for (const file of ['util.js', 'behavior.js']) vm.runInContext(readFileSync(join(ROOT, 'sidecars', 'pet', 'renderer', file), 'utf8'), context);
  return context.HAGEMI;
}

test('both languages have every line and every interface string', () => {
  assert.deepEqual(Object.keys(LINES.zhs).sort(), Object.keys(LINES.en).sort());
  assert.deepEqual(Object.keys(UI.zhs).sort(), Object.keys(UI.en).sort());
  for (const language of ['en', 'zhs']) for (const [key, entry] of Object.entries(LINES[language])) {
    assert.ok(entry.lines.length > 0, key);
    for (const line of entry.lines) assert.ok(line.trim().length > 0, key);
  }
});

test('placeholders match across languages', () => {
  const holes = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const key of Object.keys(LINES.en)) {
    const english = new Set(LINES.en[key].lines.flatMap(holes)), chinese = new Set(LINES.zhs[key].lines.flatMap(holes));
    assert.deepEqual([...chinese].sort(), [...english].sort(), key);
  }
});

test('every reaction that can speak has lines', () => {
  const speakless = new Set(['greet']);
  for (const trigger of Object.keys(REACTIONS)) if (!speakless.has(trigger)) assert.ok(LINES.en[trigger], `no lines for ${trigger}`);
});

test('every reaction plays a state and gesture that exist', () => {
  const HAGEMI = loadBehavior();
  for (const [trigger, { react }] of Object.entries(REACTIONS)) {
    if (!react) continue;
    if (react.state) assert.ok(HAGEMI.STATES[react.state], `${trigger}: unknown state ${react.state}`);
  }
});

test('every state wears a pose that exists, with landmarks', () => {
  const HAGEMI = loadBehavior();
  for (const [name, state] of Object.entries(HAGEMI.STATES)) {
    for (const pose of [].concat(state.pose)) {
      assert.ok(existsSync(join(ART, `${pose}.webp`)), `${name}: no art for ${pose}`);
      assert.ok(rig[pose], `${name}: no landmarks for ${pose}`);
    }
  }
});

test('moods map to real states', () => {
  const HAGEMI = loadBehavior();
  for (const [mood, state] of Object.entries(HAGEMI.MOODS)) assert.ok(HAGEMI.STATES[state], `${mood} -> ${state}`);
});

test('landmarks are sane for every pose', () => {
  const poses = readdirSync(ART).filter(f => f.endsWith('.webp')).map(f => f.slice(0, -5));
  assert.equal(poses.length, Object.keys(rig).length);
  for (const pose of poses) {
    const { size, eyes, blink, tail } = rig[pose];
    assert.ok(size[0] > 100 && size[1] === 640, `${pose} size`);
    assert.ok(eyes, `${pose} has no eye landmarks`);
    for (const point of [...eyes, ...(tail || [])]) assert.ok(point[0] >= 0 && point[0] <= size[0] && point[1] >= 0 && point[1] <= size[1], `${pose} point ${point}`);
    if (blink) assert.ok(existsSync(join(ART, 'blink', `${pose}.webp`)), `${pose} blink patch`);
  }
});

test('art requests cannot walk out of the art folder', () => {
  assert.ok(readArt('idle'));
  assert.ok(readArt('blink/idle'));
  for (const bad of ['../main', '..\\main', 'blink/../../main', '/etc/passwd', 'IDLE.webp', '', null, 42, `a${'b'.repeat(64)}`]) assert.equal(readArt(bad), null, String(bad));
});

test('the renderer source is one valid script', () => {
  const { source, version } = rendererSource();
  assert.doesNotThrow(() => new Function(source));
  assert.equal(version.length, 16);
  assert.ok(source.length < 400 * 1024, 'art travels separately, so the script stays small');
});

test('she only ever enters the app window', () => {
  const socket = 'ws://127.0.0.1:9000/devtools/page/1';
  assert.equal(isAppWindow({ type: 'page', url: 'https://127.0.0.1:5000/', webSocketDebuggerUrl: socket }, 9000), true);
  assert.equal(isAppWindow({ type: 'iframe', url: 'https://127.0.0.1:5000/', webSocketDebuggerUrl: socket }, 9000), false);
  assert.equal(isAppWindow({ type: 'page', url: 'https://example.com/', webSocketDebuggerUrl: socket }, 9000), false, 'agent browser tab');
  assert.equal(isAppWindow({ type: 'page', url: 'http://localhost:3000/app', webSocketDebuggerUrl: socket }, 9000), false, 'a dev server the agent opened');
  assert.equal(isAppWindow({ type: 'page', url: 'plugin://x/', webSocketDebuggerUrl: socket }, 9000), false);
  assert.equal(isAppWindow({ type: 'page', url: 'https://127.0.0.1:5000/', webSocketDebuggerUrl: 'ws://10.0.0.1:9000/x' }, 9000), false);
  assert.equal(isAppWindow({ type: 'page', url: 'not a url' }, 9000), false);
});

test('profile folders per platform', () => {
  assert.match(profileDirectory({ platform: 'win32', env: { APPDATA: 'C:\\A' }, home: 'C:\\H' }), /Antigravity$/);
  assert.match(profileDirectory({ platform: 'darwin', env: {}, home: '/H' }), /Application Support/);
  assert.equal(profileDirectory({ platform: 'linux', env: { HAGEMI_PROFILE_DIR: '/x' }, home: '/H' }), '/x');
});

test('language resolution', () => {
  assert.equal(resolveLanguage('auto', 'zh-CN'), 'zhs');
  assert.equal(resolveLanguage('auto', 'en-US'), 'en');
  assert.equal(resolveLanguage('zhs', 'en-US'), 'zhs');
  assert.equal(resolveLanguage('en', 'zh-CN'), 'en');
});

test('lines fill in and do not repeat back to back', () => {
  assert.equal(fill('{left} left', { left: '5%' }), '5% left');
  assert.equal(fill('{unknown}', {}), '{unknown}');
  const first = pickLine('en', 'turn_done', {}, () => 0), second = pickLine('en', 'turn_done', {}, () => 0);
  assert.notEqual(first.text, second.text);
  assert.equal(pickLine('en', 'no_such_moment'), null);
});
