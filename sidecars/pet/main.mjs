// Sidecar entry point: watches Antigravity, decides how she feels, and tells the pet.
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Brain, Budget, ModelResolver } from './lib/brain.mjs';
import { RendererBridge } from './lib/cdp.mjs';
import { fetchThirdPartyBalance } from './lib/balance.mjs';
import { DesktopBridge } from './lib/desktop-bridge.mjs';
import { DesktopHost } from './lib/desktop-host.mjs';
import { ambientTriggers, chooseState, classifyTurnEnd, festival, isLate, modelFamily, REACTIONS, timeOfDay } from './lib/director.mjs';
import { fill, resolveLanguage, UI } from './lib/lines.mjs';
import { LanguageServer } from './lib/ls-client.mjs';
import { Monitor } from './lib/monitor.mjs';
import { formatBalanceSpeech, formatDuration, isResetSoon, levelForModel, parseQuota, quotaEvents, quotaRows, summarize } from './lib/quota.mjs';
import { readArt } from './lib/renderer-source.mjs';
import { SettingsStore } from './lib/settings.mjs';
import { Updater, UPDATE_INTERVAL_MS } from './lib/updater.mjs';

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

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let appLanguage = 'en';
let facts = { running: 0, subagents: 0, category: null, idleMs: 0, quietMs: 0, connected: false };
let quota = { level: null, mood: 'ok', buckets: [], resetInMs: null };
let allBuckets = [];
let thirdPartyBalance = null;
let lastBalancePollAt = 0;
let desktopStatus = { status: 'idle', reason: '' };
let presence = { visible: true, focused: true, idleMs: 0 };
let selectedModel = null;
let activeSince = null, lastToolAt = 0;
let lastFactsJson = '', lastLoggedState = null, lastState = null;

const language = () => resolveLanguage(settings.value.language, appLanguage);
const ui = () => UI[language()];
const quotaOptions = () => ({ lowAt: settings.value.quota.lowAt, criticalAt: settings.value.quota.criticalAt, resetSoonMs: settings.value.quota.resetSoonMin * MINUTE });

const bridge = new RendererBridge({ onMessage: onPetMessage, log });
const desktopBridge = new DesktopBridge({
  onMessage: onPetMessage,
  onConnectionChange: () => syncSuppressed(),
  log,
});
const desktopHost = new DesktopHost({
  pluginRoot,
  onStatus: status => {
    desktopStatus = status;
    broadcastAll({ t: 'desktop_status', status });
  },
  log,
});

function sendTo(session, message) {
  if (session?.desktop) desktopBridge.post(session, message);
  else bridge.post(session, message);
}

function broadcastAll(message) {
  bridge.broadcast(message);
  desktopBridge.broadcast(message);
}

function syncSuppressed() {
  bridge.broadcast({ t: 'suppressed', suppressed: desktopBridge.hasClients() });
}

let desktopSyncQueue = Promise.resolve();
function queueDesktopSync() {
  desktopSyncQueue = desktopSyncQueue.then(async () => {
    if (stopping) return;
    if (settings.value.desktopMode) {
      const { url } = await desktopBridge.start();
      const ok = await desktopHost.start(url, { customPath: settings.value.desktopElectronPath });
      if (!ok) syncSuppressed();
    } else {
      await desktopHost.stop();
      await desktopBridge.stop();
      syncSuppressed();
    }
  }).catch(error => log(`desktop sync: ${error.message}`));
  return desktopSyncQueue;
}

const updater = new Updater({
  root: pluginRoot,
  installedRoot: join(geminiDir, 'config', 'plugins', 'hagemi-pet-agy'),
  log,
  onChange: update => broadcastAll({ t: 'update', update }),
  onInstalled: () => {
    broadcastAll({ t: 'react', state: 'happy', gesture: 'hop', burst: 'sparkles' });
    // The host's restart_policy: always brings her back with the new modules and renderer.
    setTimeout(shutdown, 1500);
  },
});
updater.local().then(local => updater.publish(local));
const brain = new Brain({
  ls, budget, models, log,
  getSettings: () => settings.value,
  getLanguage: language,
  getPresence: () => presence,
  // Comments are paid for by their own model, not by the one selected for the agent.
  getQuotaLevel: () => levelForModel(allBuckets, models.resolve(settings.value.ai.model)?.label || settings.value.ai.model),
  say: (result, trigger) => {
    broadcastAll({ t: 'say', text: result.text, mood: result.mood, ai: result.ai, force: trigger === 'greet' });
    if (process.env.HAGEMI_DEBUG) log(`${trigger}${result.ai ? ' (ai)' : ''}: ${result.text}`);
  },
});

function hudRows() {
  const strings = ui();
  const sourceBuckets = allBuckets.length ? allBuckets : quota.buckets;
  const rows = quotaRows(sourceBuckets, strings, language());
  if (settings.value.balance.enabled) {
    const label = thirdPartyBalance?.label || settings.value.balance.label || strings.hud_balance;
    const value = thirdPartyBalance
      ? (thirdPartyBalance.ok ? thirdPartyBalance.display : fill(strings.balance_failed, { error: thirdPartyBalance.error }))
      : strings.balance_refreshing;
    rows.push({ label, value });
  }
  rows.push({ label: strings.hud_agents, value: facts.subagents ? fill(strings.hud_subagents, facts) : facts.running ? fill(strings.hud_running, facts) : strings.hud_idle });
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
    subagents: facts.subagents, stashLevel: quota.level, stashLabel: quota.level == null ? '' : `${Math.round(quota.level * 100)}%`, hud: hudRows(),
  };
  const json = JSON.stringify(message);
  if (process.env.HAGEMI_DEBUG && state !== lastLoggedState) {
    lastLoggedState = state;
    log(`state: ${state} (running ${facts.running}, subagents ${facts.subagents}, tool ${facts.lastTool || '-'}, category ${facts.category || '-'})`);
  }
  if (force || json !== lastFactsJson) {
    lastFactsJson = json;
    broadcastAll(message);
  } else broadcastAll({ t: 'heartbeat' });
}

function act(trigger) {
  const reaction = REACTIONS[trigger]?.react;
  if (reaction) broadcastAll({ t: 'react', ...reaction });
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
    allBuckets = parseQuota(response, now);
    const next = summarize(allBuckets, selectedModel?.label || 'gemini', quotaOptions(), now);
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

async function pollBalance() {
  if (!settings.value.balance.enabled) {
    thirdPartyBalance = null;
    lastBalancePollAt = 0;
    publishFacts();
    return null;
  }
  lastBalancePollAt = Date.now();
  try {
    thirdPartyBalance = await fetchThirdPartyBalance(settings.value.balance);
  } catch {
    thirdPartyBalance = { ok: false, label: settings.value.balance.label || 'API', display: '', amount: null, currency: settings.value.balance.currency, detail: '', error: 'network_error', updatedAt: Date.now() };
  }
  publishFacts();
  return thirdPartyBalance;
}

function greet() {
  const now = new Date();
  const fest = festival(now);
  const scene = fest || `greet_${timeOfDay(now)}`;
  broadcastAll({ t: 'react', state: scene, ms: 4200, gesture: 'hop', burst: 'sparkles' });
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
      sendTo(session, {
        t: 'hello',
        settings: settings.value,
        ui: ui(),
        desktopStatus,
        suppressed: !session?.desktop && desktopBridge.hasClients(),
      });
      sendTo(session, { t: 'update', update: updater.state });
      lastFactsJson = '';
      publishFacts(true);
      sendModelChoices(session);
      if (session?.desktop) syncSuppressed();
      if (!greeted) { greeted = true; setTimeout(greet, 900); }
      break;
    case 'panelOpened':
      sendTo(session, { t: 'update', update: updater.state });
      sendTo(session, { t: 'desktop_status', status: desktopStatus });
      break;
    case 'update_check':
      updater.check();
      break;
    case 'update_install':
      updater.install();
      break;
    case 'art':
      sendTo(session, { t: 'art', name: message.name, data: readArt(message.name) });
      break;
    case 'query_balance':
      Promise.all([pollQuota(), pollBalance()]).then(() => {
        const tp = thirdPartyBalance ? { ...thirdPartyBalance, enabled: settings.value.balance.enabled } : { enabled: settings.value.balance.enabled, ok: false };
        broadcastAll({
          t: 'balance_report',
          rows: hudRows(),
          thirdParty: tp,
          updatedAt: Date.now(),
        });
        if (message.speak) {
          const text = formatBalanceSpeech(allBuckets, tp, ui(), language());
          broadcastAll({ t: 'say', text, mood: 'happy', ai: false, force: true });
        }
      }).catch(() => {});
      break;
    case 'settings': {
      const beforeDesktop = settings.value.desktopMode;
      const beforeElectron = settings.value.desktopElectronPath;
      const beforeBalance = JSON.stringify(settings.value.balance);
      settings.patch(message.patch);
      broadcastAll({ t: 'settings', settings: settings.value, ui: ui() });
      if (settings.value.desktopMode !== beforeDesktop || settings.value.desktopElectronPath !== beforeElectron) {
        queueDesktopSync();
      }
      if (JSON.stringify(settings.value.balance) !== beforeBalance) {
        pollBalance();
      }
      publishFacts();
      break;
    }
    case 'presence':
      presence = { visible: !!message.visible, focused: !!message.focused, idleMs: Number(message.idleMs) || 0 };
      if (message.language) appLanguage = message.language;
      break;
    case 'remount':
      if (!session?.desktop) bridge.remount(session);
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
    sendTo(session, { t: 'models', models: configs.map(c => c.label), usage: budget.usage });
  } catch { /* The picker falls back to a free-text field. */ }
}

const timers = [
  setInterval(pollQuota, 60000),
  setInterval(pollModel, 20000),
  setInterval(ambient, 5 * MINUTE),
  setInterval(() => {
    if (settings.value.balance.enabled && Date.now() - lastBalancePollAt >= settings.value.balance.pollIntervalMin * MINUTE) {
      pollBalance();
    }
  }, 60000),
];
const checkUpdates = () => { if (settings.value.autoCheckUpdates) updater.check(); };
timers.push(setTimeout(checkUpdates, 15000), setInterval(checkUpdates, UPDATE_INTERVAL_MS));
for (const timer of timers) timer.unref?.();
pollModel().then(pollQuota);
if (settings.value.balance.enabled) pollBalance();
monitor.start();
bridge.start();
if (settings.value.desktopMode) queueDesktopSync();
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
  await desktopHost.stop();
  await desktopBridge.stop();
  await bridge.stop();
  process.exit(0);
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, shutdown);

// Uninstalling while she runs fails on Windows: the app's launcher keeps the plugin folder open
// and the uninstall stops halfway, with her files gone. Leave then, so a second try succeeds.
const manifest = join(dirname(fileURLToPath(import.meta.url)), 'sidecar.json');
const orphanCheck = setInterval(() => {
  if (existsSync(manifest)) return;
  log('plugin files removed, leaving');
  shutdown();
}, 5000);
orphanCheck.unref?.();
