// Quota is her dried fish: reads the buckets, classifies how she should feel, and notices the
// moments worth reacting to (running low, a reset coming up, the bowl refilling).
const clampFraction = value => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : null;
};

export function parseQuota(response, now = Date.now()) {
  const root = response?.response || response || {};
  const buckets = [];
  for (const group of root.groups || []) {
    for (const bucket of group.buckets || []) {
      const resetAt = Date.parse(bucket.resetTime || '');
      buckets.push({
        id: bucket.bucketId || '',
        group: group.displayName || '',
        window: bucket.window || (/-(5h|weekly)$/.exec(bucket.bucketId || '')?.[1] ?? ''),
        remaining: clampFraction(bucket.remainingFraction),
        resetAt: Number.isFinite(resetAt) && resetAt > now ? resetAt : null,
      });
    }
  }
  return buckets;
}

// Which buckets a model draws from, judged by the group names the server reports.
export function bucketsForModel(buckets, label = '') {
  const lower = label.toLowerCase();
  const familyIsThirdParty = /claude|gpt|openai|anthropic/.test(lower);
  const specific = buckets.filter(b => {
    const group = b.group.toLowerCase();
    if (familyIsThirdParty) return /claude|gpt|third/.test(group);
    if (/argon/.test(lower)) return /argon/.test(group);
    return /gemini/.test(group) && !/argon/.test(group);
  });
  return specific.length ? specific : buckets;
}

// What is left for one model, whichever model the user happens to have selected.
export function levelForModel(buckets, label) {
  const known = bucketsForModel(buckets, label).filter(b => b.remaining != null);
  return known.length ? Math.min(...known.map(b => b.remaining)) : null;
}

export const moodFor = (level, { lowAt = 0.25, criticalAt = 0.1 } = {}) => {
  if (level == null) return 'ok';
  if (level <= 0.001) return 'empty';
  if (level <= criticalAt) return 'critical';
  if (level <= lowAt) return 'low';
  return 'ok';
};

export function summarize(buckets, label, options = {}, now = Date.now()) {
  const relevant = bucketsForModel(buckets, label).filter(b => b.remaining != null);
  if (!relevant.length) return { level: null, mood: 'ok', buckets: [], resetInMs: null, limiting: null };
  const limiting = relevant.reduce((low, b) => (b.remaining < low.remaining ? b : low));
  return {
    level: limiting.remaining,
    mood: moodFor(limiting.remaining, options),
    limiting,
    buckets: relevant,
    resetInMs: limiting.resetAt ? Math.max(0, limiting.resetAt - now) : null,
  };
}

// Pure: compares two summaries and reports what she should react to.
export function quotaEvents(previous, current, { resetSoonMs = 20 * 60000, resetSoonBelow = 0.5 } = {}) {
  const events = [];
  if (!previous || current.level == null || previous.level == null) return events;
  const rank = { ok: 0, low: 1, critical: 2, empty: 3 };
  if (rank[current.mood] > rank[previous.mood]) events.push({ type: `quota_${current.mood}`, level: current.level, resetInMs: current.resetInMs });
  if (current.level - previous.level > 0.12) events.push({ type: 'quota_refilled', level: current.level, wasEmpty: previous.mood === 'empty' || previous.mood === 'critical' });
  const soon = current.resetInMs != null && current.resetInMs <= resetSoonMs && current.level <= resetSoonBelow;
  const wasSoon = previous.resetInMs != null && previous.resetInMs <= resetSoonMs && previous.level <= resetSoonBelow;
  if (soon && !wasSoon) events.push({ type: 'reset_soon', level: current.level, resetInMs: current.resetInMs });
  return events;
}

export function isResetSoon(summary, { resetSoonMs = 20 * 60000, resetSoonBelow = 0.5 } = {}) {
  return summary.resetInMs != null && summary.resetInMs <= resetSoonMs && summary.level != null && summary.level <= resetSoonBelow;
}

// Status rows, headed by the server's name for the group so it is clear whose quota this is.
export function quotaRows(buckets, strings, language = 'en', now = Date.now()) {
  const rows = [];
  let group = null;
  for (const bucket of buckets) {
    if (bucket.group && bucket.group !== group) {
      group = bucket.group;
      rows.push({ label: group, value: '' });
    }
    const label = bucket.window === '5h' ? strings.hud_5h : bucket.window === 'weekly' ? strings.hud_weekly : bucket.id;
    const reset = bucket.resetAt ? ` · ${formatDuration(bucket.resetAt - now, language)}` : '';
    rows.push({ label, level: bucket.remaining, value: `${Math.round(bucket.remaining * 100)}%${reset}` });
  }
  return rows;
}

export function formatDuration(ms, language = 'en') {
  if (ms == null) return '—';
  const minutes = Math.round(ms / 60000);
  const zh = language === 'zhs';
  if (ms < 60000) return zh ? '不到 1 分钟' : '<1m';
  if (minutes < 60) return zh ? `${minutes} 分钟` : `${minutes}m`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (hours < 24) return zh ? `${hours} 小时${rest ? ` ${rest} 分` : ''}` : `${hours}h${rest ? ` ${rest}m` : ''}`;
  const days = Math.floor(hours / 24), left = hours % 24;
  return zh ? `${days} 天${left ? ` ${left} 小时` : ''}` : `${days}d${left ? ` ${left}h` : ''}`;
}
