// User settings: validated on the way in, so a hand-edited or stale file can never break her.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULTS = Object.freeze({
  language: 'auto',
  size: 'm',
  customSizePx: 0,
  bubbleScale: 100,
  desktopMode: false,
  desktopElectronPath: '',
  animation: 'balanced',
  followCursor: true,
  autoCheckUpdates: true,
  quotaHoverDelayMs: 650,
  hidden: false,
  hiddenUntil: 0,
  muted: false,
  chattiness: 'normal',
  position: null,
  quota: Object.freeze({ lowAt: 0.25, criticalAt: 0.1, resetSoonMin: 20 }),
  balance: Object.freeze({
    enabled: false,
    provider: 'auto',
    label: 'API',
    baseUrl: '',
    apiKey: '',
    currency: '¥',
    jsonPath: '',
    pollIntervalMin: 15,
  }),
  ai: Object.freeze({
    enabled: true,
    model: 'Gemini 3.8 Flash (Low)',
    minIntervalMin: 2,
    maxPerHour: 30,
    maxPerDay: 300,
    dailyTokenBudget: 200000,
    pauseBelowQuota: 0.1,
    contextLevel: 'snippets',
    onlyWhenFocused: true,
    personaExtra: '',
  }),
});

const oneOf = (value, options, fallback) => (options.includes(value) ? value : fallback);
const number = (value, low, high, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(high, Math.max(low, parsed)) : fallback;
};
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const customSizePx = (value, fallback) => {
  if (value === null || value === 0) return 0;
  if (typeof value === 'string' && !value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed <= 0 ? 0 : Math.round(Math.min(500, Math.max(80, parsed)));
};

const SETTINGS_VERSION = 2;
// Version 1 saved every value, defaults included, which would have pinned them forever.
// Values still matching the old defaults were never chosen, so they follow the new ones.
const V1_AI_DEFAULTS = { minIntervalMin: 10, maxPerHour: 4, maxPerDay: 24, dailyTokenBudget: 12000, pauseBelowQuota: 0.15 };
function migrate(saved) {
  if (saved.version >= SETTINGS_VERSION) return saved;
  const ai = { ...saved.ai };
  for (const [key, value] of Object.entries(V1_AI_DEFAULTS)) if (ai[key] === value) delete ai[key];
  return { ...saved, ai };
}

// Only what differs from the defaults is stored, so improving a default reaches everyone.
function changedFrom(defaults, value) {
  const out = {};
  for (const [key, current] of Object.entries(value)) {
    const fallback = defaults[key];
    if (current && typeof current === 'object' && fallback && typeof fallback === 'object') {
      const nested = changedFrom(fallback, current);
      if (Object.keys(nested).length) out[key] = nested;
    } else if (JSON.stringify(current) !== JSON.stringify(fallback)) out[key] = current;
  }
  return out;
}

export function sanitize(input = {}, base = DEFAULTS) {
  const quota = input.quota || {}, balance = input.balance || {}, ai = input.ai || {};
  const position = input.position;
  return {
    language: oneOf(input.language, ['auto', 'en', 'zhs'], base.language),
    size: oneOf(input.size, ['xs', 's', 'm', 'l', 'xl'], base.size),
    customSizePx: customSizePx(input.customSizePx, base.customSizePx),
    bubbleScale: Math.round(number(input.bubbleScale, 60, 180, base.bubbleScale)),
    desktopMode: bool(input.desktopMode, base.desktopMode),
    desktopElectronPath: typeof input.desktopElectronPath === 'string' ? input.desktopElectronPath.trim().slice(0, 400) : base.desktopElectronPath,
    animation: oneOf(input.animation, ['smooth', 'balanced', 'saver'], base.animation),
    followCursor: bool(input.followCursor, base.followCursor),
    autoCheckUpdates: bool(input.autoCheckUpdates, base.autoCheckUpdates),
    quotaHoverDelayMs: Math.round(number(input.quotaHoverDelayMs, 0, 10000, base.quotaHoverDelayMs)),
    hidden: bool(input.hidden, base.hidden),
    hiddenUntil: number(input.hiddenUntil, 0, 8.64e15, base.hiddenUntil),
    muted: bool(input.muted, base.muted),
    chattiness: oneOf(input.chattiness, ['quiet', 'normal', 'chatty'], base.chattiness),
    position: position === null ? null : position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? { x: number(position.x, 0, 1, 0.8), y: number(position.y, 0, 1, 0.8), ...(position.dock === 'left' || position.dock === 'right' ? { dock: position.dock } : {}) } : base.position,
    quota: {
      lowAt: number(quota.lowAt, 0.01, 0.9, base.quota.lowAt),
      criticalAt: number(quota.criticalAt, 0.005, 0.5, base.quota.criticalAt),
      resetSoonMin: number(quota.resetSoonMin, 1, 180, base.quota.resetSoonMin),
    },
    balance: {
      enabled: bool(balance.enabled, base.balance.enabled),
      provider: oneOf(balance.provider, ['auto', 'deepseek', 'openai_billing', 'custom_json'], base.balance.provider),
      label: typeof balance.label === 'string' ? (balance.label.trim().slice(0, 24) || DEFAULTS.balance.label) : base.balance.label,
      baseUrl: typeof balance.baseUrl === 'string' ? balance.baseUrl.trim().slice(0, 300) : base.balance.baseUrl,
      apiKey: typeof balance.apiKey === 'string' ? balance.apiKey.trim().slice(0, 300) : base.balance.apiKey,
      currency: typeof balance.currency === 'string' ? (balance.currency.trim().slice(0, 6) || DEFAULTS.balance.currency) : base.balance.currency,
      jsonPath: typeof balance.jsonPath === 'string' ? balance.jsonPath.trim().slice(0, 120) : base.balance.jsonPath,
      pollIntervalMin: Math.round(number(balance.pollIntervalMin, 1, 1440, base.balance.pollIntervalMin)),
    },
    ai: {
      enabled: bool(ai.enabled, base.ai.enabled),
      model: typeof ai.model === 'string' && ai.model.trim() ? ai.model.trim().slice(0, 80) : base.ai.model,
      minIntervalMin: number(ai.minIntervalMin, 1, 1440, base.ai.minIntervalMin),
      maxPerHour: number(ai.maxPerHour, 0, 60, base.ai.maxPerHour),
      maxPerDay: number(ai.maxPerDay, 0, 500, base.ai.maxPerDay),
      dailyTokenBudget: number(ai.dailyTokenBudget, 0, 500000, base.ai.dailyTokenBudget),
      pauseBelowQuota: number(ai.pauseBelowQuota, 0, 1, base.ai.pauseBelowQuota),
      contextLevel: oneOf(ai.contextLevel, ['minimal', 'titles', 'snippets'], base.ai.contextLevel),
      onlyWhenFocused: bool(ai.onlyWhenFocused, base.ai.onlyWhenFocused),
      personaExtra: typeof ai.personaExtra === 'string' ? ai.personaExtra.slice(0, 600) : base.ai.personaExtra,
    },
  };
}

export class SettingsStore {
  constructor(file) {
    this.file = file;
    let saved = {};
    try { saved = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { /* First run or unreadable: defaults. */ }
    this.value = sanitize(migrate(saved));
  }

  patch(change = {}) {
    const merged = {
      ...this.value,
      ...change,
      quota: { ...this.value.quota, ...change.quota },
      balance: { ...this.value.balance, ...change.balance },
      ai: { ...this.value.ai, ...change.ai },
    };
    this.value = sanitize(merged, this.value);
    this.save();
    return this.value;
  }

  save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: SETTINGS_VERSION, ...changedFrom(DEFAULTS, this.value) }, null, 2));
      renameSync(temporary, this.file);
    } catch { /* Settings are a convenience; failing to save must not stop the pet. */ }
  }
}
