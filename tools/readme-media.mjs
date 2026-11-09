// Records the README animations and screenshots from the rehearsal stage, never the real app,
// so only made-up data is ever on screen. Needs Microsoft Edge (or Chrome) and Python with Pillow.
// Usage: npm run media -- [--lang en|zhs] [scene...]
//   en  -> docs/media/       zhs -> docs/media/zhs/
// Raw frames go to <temp>/hagemi-readme-media/<lang>/, then tools/readme_media.py turns them into WebP.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES, UI, fill } from '../sidecars/pet/lib/lines.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const langAt = args.indexOf('--lang');
const LANG = langAt >= 0 ? args.splice(langAt, 2)[1] : 'en';
if (!LINES[LANG]) throw new Error(`unknown language ${LANG}`);
const OTHER = LANG === 'en' ? 'zhs' : 'en';
const ONLY = args;
const OUT = join(tmpdir(), 'hagemi-readme-media', LANG);
const MEDIA = join(ROOT, 'docs', 'media', ...(LANG === 'en' ? [] : [LANG]));
const W = 900, H = 700, STILL_H = 1000;
const STAGE_PORT = 7894, DEBUG_PORT = 9378;

// One line from her script, in the language being recorded.
const line = (key, index = 0, vars = {}, lang = LANG) => fill(LINES[lang][key].lines[index], vars);

const browser = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync);
if (!browser) throw new Error('Edge or Chrome is needed to record');

const stage = spawn(process.execPath, [join(ROOT, 'tools', 'preview.mjs')], { env: { ...process.env, HAGEMI_PREVIEW_PORT: String(STAGE_PORT) }, stdio: 'ignore' });
const userDir = mkdtempSync(join(tmpdir(), 'hagemi-media-'));
const child = spawn(browser, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDir}`, `--window-size=${W},${STILL_H}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => {
  for (const p of [child, stage]) try { p.kill(); } catch {}
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);
process.on('uncaughtException', e => { console.error(e); process.exit(1); });
process.on('unhandledRejection', e => { console.error(e); process.exit(1); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 80 && !target; i++) {
  await sleep(250);
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
}
if (!target) throw new Error('the browser did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0, onFrame = null;
const pending = new Map(), errors = [];
ws.onmessage = event => {
  const m = JSON.parse(event.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Page.screencastFrame' && onFrame) onFrame(m.params);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
await new Promise(r => { ws.onopen = r; });
const cmd = (method, params = {}) => new Promise(resolve => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async expression => {
  const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || expression);
  return r.result?.result?.value;
};

await cmd('Page.enable');
await cmd('Runtime.enable');
await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
await cmd('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
const viewport = height => cmd('Emulation.setDeviceMetricsOverride', { width: W, height, deviceScaleFactor: 1, mobile: false });
const mouse = (type, x, y, buttons = 0, button = 'none', clickCount = 0) => cmd('Input.dispatchMouseEvent', { type, x, y, buttons, button, clickCount });

async function load({ lang = LANG, x = 0.5, y = 0.62, dock = null, height = H } = {}) {
  await viewport(height);
  await cmd('Page.navigate', { url: `http://127.0.0.1:${STAGE_PORT}/?lang=${lang}&size=xl&theme=light` });
  await sleep(2500);
  await js(`(() => {
    document.getElementById('panel').style.display = 'none';
    for (const el of [document.documentElement, document.body]) el.style.background = 'transparent';
    window.__hagemiPet.receive({ t: 'hello', settings: { ...defaults, size: 'xl', position: { x: ${x}, y: ${y}${dock ? `, dock: '${dock}'` : ''} } }, ui: UI['${lang}'] });
    return true;
  })()`);
  await sleep(1500);
}

// Warms up pose images so the first frame of each pose isn't blank.
const preload = async names => {
  for (const name of names) { await js(`window.__rehearse('States', '${name}')`); await sleep(900); }
  await js(`window.__rehearse('States', 'idle')`);
  await sleep(600);
};

// timeline: [[ms, async () => {}], ...]. Frames stream in as they are painted, named by time in ms.
async function record(name, seconds, timeline = []) {
  for (let attempt = 1; ; attempt++) {
    const dir = join(OUT, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const steps = [...timeline].sort((a, b) => a[0] - b[0]);
    let start = null, last = 0, gap = 0, count = 0;
    onFrame = params => {
      const t = params.metadata.timestamp * 1000;
      if (start === null) start = t;
      const at = Math.round(t - start);
      gap = Math.max(gap, at - last);
      last = at;
      writeFileSync(join(dir, `${String(at).padStart(6, '0')}.png`), Buffer.from(params.data, 'base64'));
      count++;
      cmd('Page.screencastFrameAck', { sessionId: params.sessionId });
    };
    await cmd('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    const begin = performance.now();
    for (const [at, step] of steps) {
      const wait = at - (performance.now() - begin);
      if (wait > 0) await sleep(wait);
      await step();
    }
    const rest = seconds * 1000 - (performance.now() - begin);
    if (rest > 0) await sleep(rest);
    await cmd('Page.stopScreencast');
    onFrame = null;
    // The headless screencast sometimes stalls for a moment; a stall would show as a freeze, so retake.
    const smooth = gap < 300 && seconds * 1000 - last < 300;
    console.log(`${name}: ${count} frames, ${(count / seconds).toFixed(1)} fps, longest gap ${gap} ms${smooth ? '' : ', retaking'}`);
    if (smooth || attempt >= 4) return;
    await mouse('mouseMoved', 5, 5);
    await js(`window.__rehearse('States', 'idle')`);
    await sleep(4000);
  }
}

async function still(name) {
  await sleep(150);
  const shot = await cmd('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
  console.log(`${name}: still`);
}

const pet = expression => () => js(`window.__hagemiPet.${expression}`);
const say = (text, mood) => pet(`receive({ t: 'say', text: ${JSON.stringify(text)}, mood: '${mood}', force: true })`);
const speak = (key, index = 0, vars = {}, lang = LANG) => say(line(key, index, vars, lang), LINES[lang][key].mood);
const react = message => pet(`receive(${JSON.stringify({ t: 'react', ...message })})`);
const facts = patch => () => js(`(() => { Object.assign(facts, ${JSON.stringify(patch)}); window.__hagemiPet.receive({ t: 'facts', ...facts }); return true; })()`);
const position = () => js('window.__hagemiPet.position');
// In, click, and straight back out, so the hover status panel never opens.
const click = ([px, py]) => async () => {
  await mouse('mouseMoved', px, py);
  await mouse('mousePressed', px, py, 1, 'left', 1);
  await mouse('mouseReleased', px, py, 0, 'left', 1);
  await mouse('mouseMoved', 5, 5);
};

const SCENES = {
  async hello() {
    await load();
    await record('hello', 6.5, [
      [300, react({ gesture: 'hop', burst: 'sparkles' })],
      [500, speak('greet_afternoon')],
      [4200, react({ gesture: 'tailSwish' })],
    ]);
  },
  async reactions() {
    await load();
    await preload(['happy', 'proud', 'oops']);
    await record('reactions', 13, [
      [200, react({ state: 'happy', ms: 3200, gesture: 'hop', burst: 'sparkles' })],
      [300, speak('turn_done')],
      [4300, react({ state: 'proud', ms: 3600, gesture: 'spin', burst: 'confetti' })],
      [4400, speak('turn_done_big', 2)],
      [8800, react({ state: 'oops', ms: 4000, gesture: 'shiver', burst: 'sweat' })],
      [8900, speak('turn_error')],
    ]);
  },
  async work() {
    await load();
    const states = ['reading', 'writing', 'running', 'searching', 'drawing'];
    await preload(states);
    await record('work', 9, states.map((state, i) => [i * 1800, facts({ state })]));
  },
  async subagents() {
    await load();
    await preload(['delegating', 'proud']);
    await record('subagents', 6.5, [
      [200, facts({ state: 'delegating', subagents: 1 })],
      [1200, facts({ subagents: 2 })],
      [2000, facts({ subagents: 3 })],
      [2300, react({ state: 'proud', ms: 2600, gesture: 'bounce', burst: 'sparkles' })],
      [2400, speak('subagent_many', 1)],
    ]);
  },
  async quota() {
    await load();
    await preload(['tired', 'gift']);
    await record('quota', 10, [
      [200, facts({ state: 'tired', quota: 'low', stashLevel: 0.18, stashLabel: '18%' })],
      [400, speak('quota_low', 1, { left: '18%' })],
      [5200, facts({ state: 'idle', quota: 'ok', stashLevel: 1, stashLabel: '100%' })],
      [5200, react({ state: 'gift', ms: 4200, gesture: 'bounce', burst: ['fish', 'confetti'] })],
      [5300, speak('quota_refilled')],
    ]);
  },
  async touch() {
    await load();
    await preload(['pat', 'surprised', 'annoyed', 'puffed', 'redhot', 'sulk', 'coaxed', 'forgiven']);
    const { x, y } = await position();
    const head = [x, y - 150], body = [x + 10, y + 60];
    const steps = [[300, click(head)], [400, speak('pet')], [1300, click(head)]];
    let t = 2800;
    for (let i = 0; i < 7; i++) { steps.push([t, click(body)]); t += 650; }
    // The lines the sidecar would answer these touches with.
    steps.push([2800 + 650 * 5 + 50, speak('redhot')]);
    steps.push([2800 + 650 * 6 + 50, speak('sulk')]);
    steps.push([t + 2000, click(head)]);
    steps.push([t + 2100, speak('coax')]);
    await record('touch', (t + 5200) / 1000, steps);
  },
  async drag() {
    await load({ x: 0.3, y: 0.6 });
    await preload(['surprised', 'dizzy']);
    const { x, y } = await position();
    const steps = [[0, () => mouse('mouseMoved', x, y + 40)], [200, () => mouse('mousePressed', x, y + 40, 1, 'left', 1)]];
    // A slow loop, then a fling to the right.
    for (let i = 1; i <= 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      steps.push([200 + i * 50, () => mouse('mouseMoved', x + Math.sin(a) * 140, y + 40 - (1 - Math.cos(a)) * 70, 1)]);
    }
    for (let i = 1; i <= 6; i++) steps.push([1800 + i * 25, () => mouse('mouseMoved', x + i * 45, y + 40, 1)]);
    steps.push([1960, () => mouse('mouseReleased', x + 270, y + 40, 0, 'left', 1)]);
    steps.push([2000, () => mouse('mouseMoved', 5, 5)]);
    await record('drag', 5, steps);
  },
  async dock() {
    await load({ x: 1, y: 0.6, dock: 'right' });
    const { y } = await position();
    // Close enough to make her peek, but never over her, so the status panel stays shut.
    const steps = [[0, () => mouse('mouseMoved', W - 420, y)]];
    for (let i = 1; i <= 20; i++) steps.push([1000 + i * 40, () => mouse('mouseMoved', W - 420 + i * 12.4, y)]);
    for (let i = 1; i <= 20; i++) steps.push([3800 + i * 40, () => mouse('mouseMoved', W - 172 - i * 12.4, y)]);
    await record('dock', 6, steps);
  },
  // The other language, to show she speaks both.
  async language() {
    await load({ lang: OTHER });
    await preload(['proud']);
    await record('language', 5, [
      [200, react({ state: 'proud', ms: 3600, gesture: 'spin', burst: 'confetti' })],
      [300, speak('turn_done_big', 0, { count: 12 }, OTHER)],
    ]);
  },
  async stills() {
    await load({ y: 0.56, height: STILL_H });
    const { x, y } = await position();
    await sleep(1500);
    for (let i = 0; i < 6; i++) { await mouse('mouseMoved', x - 10 + i * 4, y + 30); await sleep(120); }
    await sleep(1800);
    await still('status');
    await mouse('mouseMoved', 30, 30);
    await sleep(2000);
    await mouse('mouseMoved', x, y + 30);
    await sleep(200);
    await mouse('mouseMoved', x + 2, y + 32);
    await mouse('mousePressed', x + 2, y + 32, 2, 'right', 1);
    await mouse('mouseReleased', x + 2, y + 32, 0, 'right', 1);
    await sleep(500);
    await still('menu');
    // DOM.performSearch also walks closed shadow roots, so the menu item can be found by its text.
    await cmd('DOM.enable');
    await cmd('DOM.getDocument', { depth: -1, pierce: true });
    const { searchId, resultCount } = (await cmd('DOM.performSearch', { query: UI[LANG].settings, includeUserAgentShadowDOM: true })).result;
    const ids = resultCount ? (await cmd('DOM.getSearchResults', { searchId, fromIndex: 0, toIndex: resultCount })).result.nodeIds : [];
    for (const nodeId of ids) {
      const box = (await cmd('DOM.getBoxModel', { nodeId })).result;
      if (!box) continue;
      const q = box.model.content, px = (q[0] + q[4]) / 2, py = (q[1] + q[5]) / 2;
      await mouse('mouseMoved', px, py);
      await mouse('mousePressed', px, py, 1, 'left', 1);
      await mouse('mouseReleased', px, py, 0, 'left', 1);
      await sleep(900);
      await still('settings');
      return;
    }
    console.log('settings: menu item not found, skipped');
  },
};

for (let i = 0; i < 40; i++) {
  try { await fetch(`http://127.0.0.1:${STAGE_PORT}/`); break; } catch { await sleep(250); }
}
mkdirSync(OUT, { recursive: true });
const run = Object.keys(SCENES).filter(name => !ONLY.length || ONLY.includes(name));
for (const name of run) await SCENES[name]();
if (errors.length) console.log('page errors:', errors.slice(0, 5));
cleanup();

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const built = spawnSync(python, [join(ROOT, 'tools', 'readme_media.py'), OUT, MEDIA, ...run], { stdio: 'inherit' });
process.exit(built.status ?? 1);
