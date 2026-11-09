#!/usr/bin/env node
// A rehearsal stage: runs the pet in any browser with buttons for every state and reaction.
// No Antigravity needed. Usage: npm run preview, then open http://127.0.0.1:7891
import { createServer } from 'node:http';
import { rendererSource, readArt } from '../sidecars/pet/lib/renderer-source.mjs';
import { LINES, UI, fill, pickLine } from '../sidecars/pet/lib/lines.mjs';
import { quotaRows } from '../sidecars/pet/lib/quota.mjs';
import { DEFAULTS } from '../sidecars/pet/lib/settings.mjs';

const PORT = Number(process.env.HAGEMI_PREVIEW_PORT || 7891);

// Made-up status rows, built the way the sidecar builds them so the panel reads the same in each language.
const NOW = Date.now(), HOUR = 3600000;
const HUD = Object.fromEntries(Object.entries(UI).map(([lang, strings]) => [lang, [
  ...quotaRows([{ window: '5h', remaining: 0.82, resetAt: NOW + 3.2 * HOUR }, { window: 'weekly', remaining: 0.6, resetAt: NOW + 76 * HOUR }], strings, lang, NOW),
  { label: strings.hud_agents, value: fill(strings.hud_running, { running: 1 }) },
  { label: strings.hud_comments, value: `3/${DEFAULTS.ai.maxPerDay} · ~1640` },
]]));

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hagemi rehearsal</title>
<style>
:root { color-scheme: light dark; --bg: #f5f3ff; --fg: #2a1b3d; --panel: #fff; --line: #ddd6fe; }
:root[data-theme="dark"] { --bg: #16131f; --fg: #ece8f7; --panel: #221c33; --line: #3b3259; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.4 "Segoe UI", system-ui, sans-serif; height: 100vh; }
#panel { position: fixed; left: 12px; top: 12px; width: 372px; max-height: calc(100vh - 24px); overflow: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
h2 { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; opacity: .65; margin: 10px 0 5px; }
button { font: inherit; padding: 3px 8px; margin: 2px; border-radius: 7px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
button:hover { background: #a78bfa33; }
</style></head><body>
<div id="panel"><b>Hagemi rehearsal stage</b><div id="groups"></div></div>
<script>
window.__hagemiCall = json => {
  const m = JSON.parse(json);
  if (m.type === 'art') { fetch('/art?name=' + encodeURIComponent(m.name)).then(r => r.text()).then(data => window.__hagemiPet ? window.__hagemiPet.receive({ t: 'art', name: m.name, data }) : queue.push({ t: 'art', name: m.name, data })); return; }
  console.log('[pet]', m);
  if (m.type === 'ready') boot();
};
const queue = [];
const defaults = ${JSON.stringify(DEFAULTS)};
const UI = ${JSON.stringify(UI)};
const SCRIPT = ${JSON.stringify(LINES)};
const HUD = ${JSON.stringify(HUD)};
const lang = () => new URLSearchParams(location.search).get('lang') || 'en';
const facts = { state: 'idle', quota: 'ok', stashLevel: 0.82, stashLabel: '82%', subagents: 0, hud: HUD[lang()] || HUD.en };
const push = () => window.__hagemiPet && window.__hagemiPet.receive({ t: 'facts', ...facts });
function boot() {
  const wait = setInterval(() => { if (window.__hagemiPet) { clearInterval(wait); for (const item of queue.splice(0)) window.__hagemiPet.receive(item); window.__hagemiPet.receive({ t: 'hello', settings: { ...defaults, size: new URLSearchParams(location.search).get('size') || 'l', position: { x: 0.68, y: 0.56 } }, ui: UI[lang()] }); window.__hagemiPet.receive({ t: 'models', models: ['Gemini 3.8 Flash (Low)', 'Gemini 3.8 Flash (High)', 'Claude Opus 5.5 (Low)'], usage: { calls: 3, tokens: 1640 } }); push(); } }, 30);
}
const groups = {
  'States': ${JSON.stringify(['idle', 'listening', 'thinking', 'deepthink', 'reading', 'writing', 'running', 'searching', 'drawing', 'delegating', 'compacting', 'asking', 'busy', 'swamped', 'tired', 'exhausted', 'resetSoon', 'sleeping', 'dizzy', 'petted', 'coaxed', 'annoyed', 'puffed', 'redhot', 'sulk', 'forgiven', 'happy', 'proud', 'oops', 'surprised', 'hum', 'float', 'stretch', 'yawn', 'gift', 'bye'])},
  'Gestures': ${JSON.stringify(['hop', 'bounce', 'spin', 'shiver', 'nod', 'shake', 'tailSwish', 'lookAround', 'gasp', 'recoil', 'squish', 'drift', 'flop', 'earFlick'])},
  'Bursts': ${JSON.stringify(['confetti', 'sparkles', 'hearts', 'sweat', 'steam', 'fish', 'notes', 'dust'])},
  'Quota': ['ok', 'half', 'low', 'critical', 'empty'],
  'Subagents': [0, 1, 2, 3, 5],
  'Speech': ['en', 'zhs', 'ai'],
  'Moments': Object.keys(SCRIPT.en),
  'Theme': ['light', 'dark'],
};
const lines = { en: 'Four tools in one breath? Fine, I will allow it. Extremely efficient, nya.', zhs: '一口气跑四个工具？行吧，本喵极其极其满意喵~' };
const groupsEl = document.getElementById('groups');
for (const [name, items] of Object.entries(groups)) {
  const h = document.createElement('h2'); h.textContent = name; groupsEl.append(h);
  for (const item of items) {
    const b = document.createElement('button'); b.textContent = item; b.dataset.group = name; b.dataset.item = item;
    b.onclick = () => run(name, item); groupsEl.append(b);
  }
}
function run(name, item) {
  const pet = window.__hagemiPet;
  if (name === 'States') { facts.state = item; push(); }
  if (name === 'Gestures') pet.receive({ t: 'react', gesture: item });
  if (name === 'Bursts') pet.receive({ t: 'react', burst: item });
  if (name === 'Quota') { facts.quota = item; facts.stashLevel = { ok: 0.82, half: 0.5, low: 0.2, critical: 0.06, empty: 0 }[item]; facts.quota = item === 'half' ? 'ok' : item === 'empty' ? 'critical' : item; facts.stashLabel = Math.round(facts.stashLevel * 100) + '%'; push(); }
  if (name === 'Subagents') { facts.subagents = item; push(); }
  if (name === 'Speech') pet.receive({ t: 'say', text: lines[item === 'ai' ? 'en' : item], ai: item === 'ai', mood: 'smug' });
  if (name === 'Moments') { const entry = SCRIPT[lang()][item]; pet.receive({ t: 'say', text: entry.lines[0], mood: entry.mood, force: true }); }
  if (name === 'Theme') document.documentElement.dataset.theme = item;
}
window.__rehearse = run;
const initial = new URLSearchParams(location.search).get('theme');
if (initial) document.documentElement.dataset.theme = initial;
</script>
<script src="/pet.js"></script>
</body></html>`;

createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/art') {
    const data = readArt(url.searchParams.get('name'));
    response.writeHead(data ? 200 : 404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    response.end(data || '');
    return;
  }
  if (url.pathname === '/pet.js') {
    // Re-read on every load so edits show up with a refresh.
    const { source } = rendererSource({ standalone: true });
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(source);
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(page);
}).listen(PORT, '127.0.0.1', () => console.log(`Hagemi rehearsal stage: http://127.0.0.1:${PORT}`));
