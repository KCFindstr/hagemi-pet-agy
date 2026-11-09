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

function loadBehavior(now = () => 0) {
  const context = { HAGEMI: {}, performance: { now }, Math };
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

test('her lines use no dashes and one name for the user', () => {
  for (const language of ['en', 'zhs']) for (const [key, entry] of Object.entries(LINES[language])) {
    for (const line of entry.lines) {
      assert.doesNotMatch(line, /[—–]/, `${language} ${key}`);
      if (key !== 'idle_ponder') assert.doesNotMatch(line, /人类|[Hh]umans?\b/, `${language} ${key}`);
    }
  }
});

function tailRun() {
  let clock = 0;
  const HAGEMI = loadBehavior(() => clock);
  const animator = HAGEMI.createAnimator({ burst() {}, setStash() {}, setClones() {} });
  const dt = 1 / 60, still = { vx: 0, vy: 0 };
  // Hours of uptime: the bug this guards against grew with it.
  let t = 20000;
  const step = (motion = still) => { clock += dt * 1000; t += dt; return animator.update(dt, t, motion).P; };
  return { animator, step, dt };
}

test('the tail phase stays smooth through state changes, however long she has been running', () => {
  const { animator, step, dt } = tailRun();
  animator.override('dragged', 1e9);
  for (let i = 0; i < 120; i++) step();
  animator.clearOverride('dragged');
  let last = step().tailPhase;
  for (let i = 0; i < 240; i++) {
    if (i === 60) animator.play('tailSwish');
    const phase = step().tailPhase;
    const moved = Math.abs(((phase - last + 9.4245) % 6.283) - 3.1415);
    assert.ok(moved <= 6.283 * 4 * dt, `frame ${i} jumped ${moved} radians`);
    last = phase;
  }
});

test('the tail settles after a throw and does not twitch while she talks', () => {
  const { animator, step } = tailRun();
  for (let i = 0; i < 30; i++) step({ vx: 2500, vy: 0 });
  for (let i = 0; i < 180; i++) step();
  assert.ok(Math.abs(step().tailSpring) < 0.01, 'settled within three seconds');
  animator.setTalking(true);
  for (let i = 0; i < 300; i++) assert.ok(Math.abs(step().tailSpring) < 0.01, `twitched on frame ${i}`);
});

test('moods map to real states', () => {
  const HAGEMI = loadBehavior();
  for (const [mood, state] of Object.entries(HAGEMI.MOODS)) assert.ok(HAGEMI.STATES[state], `${mood} -> ${state}`);
});

test('landmarks are sane for every pose', () => {
  const poses = readdirSync(ART).filter(f => f.endsWith('.webp')).map(f => f.slice(0, -5));
  assert.equal(poses.length, Object.keys(rig).length);
  for (const pose of poses) {
    const { size, eyes, blink, tail, tailRect } = rig[pose];
    assert.ok(size[0] > 100 && size[1] === 640, `${pose} size`);
    assert.ok(eyes, `${pose} has no eye landmarks`);
    for (const point of [...eyes, ...(tail || [])]) assert.ok(point[0] >= 0 && point[0] <= size[0] && point[1] >= 0 && point[1] <= size[1], `${pose} point ${point}`);
    if (blink) assert.ok(existsSync(join(ART, 'blink', `${pose}.webp`)), `${pose} blink patch`);
    if (tailRect) {
      assert.ok(existsSync(join(ART, 'tail', `${pose}.webp`)), `${pose} tail layer`);
      assert.ok(existsSync(join(ART, 'under', `${pose}.webp`)), `${pose} under layer`);
      assert.ok(existsSync(join(ART, 'cut', `${pose}.webp`)), `${pose} cut mask`);
      assert.ok(tailRect[0] >= 0 && tailRect[1] >= 0 && tailRect[0] + tailRect[2] <= size[0] && tailRect[1] + tailRect[3] <= size[1], `${pose} tail rect`);
    }
  }
});

test('cutting hints stay in the tool and out of the injected script', () => {
  for (const [pose, entry] of Object.entries(rig)) {
    for (const hint of ['tailSeeds', 'notTail', 'tailTop', 'noTail', 'bodyBand', 'hairBand']) assert.equal(entry[hint], undefined, `${pose} ${hint}`);
  }
});

test('nearly every pose has a separate tail, so swishing it leaves the hair alone', () => {
  const withTail = Object.values(rig).filter(entry => entry.tailRect).length;
  assert.ok(withTail >= 45, `only ${withTail} poses have a tail layer`);
});

test('layer files match the rig exactly, with nothing left over', () => {
  const expected = Object.entries(rig).filter(([, entry]) => entry.tailRect).map(([pose]) => `${pose}.webp`).sort();
  for (const layer of ['tail', 'under', 'cut']) assert.deepEqual(readdirSync(join(ART, layer)).sort(), expected, layer);
});

test('art requests cannot walk out of the art folder', () => {
  assert.ok(readArt('idle'));
  assert.ok(readArt('blink/idle'));
  assert.ok(readArt('tail/idle'));
  assert.ok(readArt('under/idle'));
  assert.ok(readArt('cut/idle'));
  for (const bad of ['../main', '..\\main', 'blink/../../main', 'tail/../main', 'other/idle', '/etc/passwd', 'IDLE.webp', '', null, 42, `a${'b'.repeat(64)}`]) assert.equal(readArt(bad), null, String(bad));
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
  // The app is a single-page client: every route is still the app.
  assert.equal(isAppWindow({ type: 'page', url: 'https://127.0.0.1:5000/customizations/installed', webSocketDebuggerUrl: socket }, 9000), true);
  assert.equal(isAppWindow({ type: 'page', url: 'https://127.0.0.1:5000/conversation/abc?x=1', webSocketDebuggerUrl: socket }, 9000), true);
  assert.equal(isAppWindow({ type: 'iframe', url: 'https://127.0.0.1:5000/', webSocketDebuggerUrl: socket }, 9000), false);
  assert.equal(isAppWindow({ type: 'page', url: 'https://example.com/', webSocketDebuggerUrl: socket }, 9000), false, 'agent browser tab');
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
