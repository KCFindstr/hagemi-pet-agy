// Optional third-party API / relay balance fetcher.
// Runs only when configured by the user; never returns or logs the API key.

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function normalizeBaseUrl(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const cleanPath = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${cleanPath}`;
  } catch {
    return null;
  }
}

export function extractByPath(obj, path) {
  if (!obj || typeof path !== 'string') return undefined;
  const parts = path.split('.').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  let cur = obj;
  for (const part of parts) {
    if (FORBIDDEN_KEYS.has(part)) return undefined;
    if (cur === null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(part)) return undefined;
      const idx = Number(part);
      if (idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
      cur = cur[part];
    }
  }
  return cur;
}

export function formatMoney(amount, currency = '$') {
  const num = Number(amount);
  if (!Number.isFinite(num)) return '';
  return `${currency || ''}${num.toFixed(2)}`;
}

export function parseDeepSeekBalance(json) {
  const infos = json?.balance_infos;
  if (!Array.isArray(infos) || !infos.length) return null;
  const preferred = infos.find(item => item?.currency === 'CNY') || infos[0];
  const amount = Number(preferred?.total_balance);
  if (!Number.isFinite(amount)) return null;
  const rawCur = String(preferred?.currency || '').toUpperCase();
  const currency = rawCur === 'CNY' ? '¥' : rawCur === 'USD' ? '$' : rawCur;
  return { amount, currency, isAvailable: json?.is_available !== false };
}

export function parseCreditGrants(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.total_available !== undefined) {
    const avail = Number(json.total_available);
    if (Number.isFinite(avail)) return avail;
  }
  if (json.total_granted !== undefined && json.total_used !== undefined) {
    const granted = Number(json.total_granted);
    const used = Number(json.total_used);
    if (Number.isFinite(granted) && Number.isFinite(used)) return granted - used;
  }
  return null;
}

function joinApiPath(base, suffix) {
  if (base.endsWith('/v1') && suffix.startsWith('/v1/')) {
    return `${base}${suffix.slice(3)}`;
  }
  return `${base}${suffix}`;
}

function monthRange(now) {
  const d = new Date(now);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(now + 86400000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function safeErrorCode(err, apiKey) {
  const msg = String(err?.message || err || 'network_error');
  if (err?.name === 'TimeoutError' || /timeout|aborted/i.test(msg)) return 'timeout';
  if (apiKey && msg.includes(apiKey)) return 'network_error';
  return 'network_error';
}

async function fetchJson(url, headers, fetchFn, apiKey) {
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, status: res.status, error: `http_${res.status}`, json: null };
    try {
      const json = await res.json();
      return { ok: true, status: res.status, error: '', json };
    } catch {
      return { ok: false, status: res.status, error: 'parse_error', json: null };
    }
  } catch (err) {
    return { ok: false, status: 0, error: safeErrorCode(err, apiKey), json: null };
  }
}

export async function fetchThirdPartyBalance(config = {}, { fetchFn = fetch, now = Date.now() } = {}) {
  const label = (typeof config.label === 'string' && config.label.trim()) ? config.label.trim() : 'API';
  const fallbackCurrency = typeof config.currency === 'string' ? config.currency : '¥';
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl) {
    return { ok: false, label, display: '', amount: null, currency: fallbackCurrency, detail: '', error: 'invalid_url', updatedAt: now };
  }

  const provider = config.provider || 'auto';
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  let effective = provider;
  if (effective === 'auto') {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host.includes('deepseek.com')) effective = 'deepseek';
    else if (typeof config.jsonPath === 'string' && config.jsonPath.trim()) effective = 'custom_json';
    else effective = 'auto_probe';
  }

  if (effective !== 'custom_json' && !apiKey) {
    return { ok: false, label, display: '', amount: null, currency: fallbackCurrency, detail: '', error: 'missing_key', updatedAt: now };
  }

  const headers = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const tryDeepSeek = async () => {
    const res = await fetchJson(joinApiPath(baseUrl, '/user/balance'), headers, fetchFn, apiKey);
    if (!res.ok) return { ok: false, error: res.error };
    const parsed = parseDeepSeekBalance(res.json);
    if (!parsed) return { ok: false, error: 'parse_error' };
    const cur = parsed.currency || fallbackCurrency;
    return {
      ok: true,
      amount: parsed.amount,
      currency: cur,
      display: formatMoney(parsed.amount, cur),
      detail: 'DeepSeek',
    };
  };

  const tryOpenAiBilling = async () => {
    const grantsRes = await fetchJson(joinApiPath(baseUrl, '/v1/dashboard/billing/credit_grants'), headers, fetchFn, apiKey);
    if (grantsRes.ok) {
      const amount = parseCreditGrants(grantsRes.json);
      if (amount !== null) {
        return {
          ok: true,
          amount,
          currency: fallbackCurrency || '$',
          display: formatMoney(amount, fallbackCurrency || '$'),
          detail: 'credit_grants',
        };
      }
    }
    const subRes = await fetchJson(joinApiPath(baseUrl, '/v1/dashboard/billing/subscription'), headers, fetchFn, apiKey);
    if (!subRes.ok) return { ok: false, error: grantsRes.error || subRes.error, status: subRes.status };
    const limit = Number(subRes.json?.hard_limit_usd ?? subRes.json?.system_hard_limit_usd);
    if (!Number.isFinite(limit)) return { ok: false, error: 'parse_error' };
    const { startDate, endDate } = monthRange(now);
    const usageRes = await fetchJson(
      joinApiPath(baseUrl, `/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`),
      headers,
      fetchFn,
      apiKey,
    );
    const usedCents = Number(usageRes.json?.total_usage);
    const usedUsd = usageRes.ok && Number.isFinite(usedCents) ? usedCents / 100 : 0;
    const amount = Math.max(0, limit - usedUsd);
    return {
      ok: true,
      amount,
      currency: fallbackCurrency || '$',
      display: formatMoney(amount, fallbackCurrency || '$'),
      detail: usageRes.ok ? `sub ${formatMoney(limit, fallbackCurrency || '$')}` : 'subscription',
    };
  };

  let result;
  if (effective === 'deepseek') {
    result = await tryDeepSeek();
  } else if (effective === 'custom_json') {
    const res = await fetchJson(baseUrl, headers, fetchFn, apiKey);
    if (!res.ok) {
      result = { ok: false, error: res.error };
    } else {
      const val = extractByPath(res.json, config.jsonPath);
      const amount = Number(val);
      if (val === undefined || val === null || val === '' || !Number.isFinite(amount)) {
        result = { ok: false, error: 'parse_error' };
      } else {
        result = {
          ok: true,
          amount,
          currency: fallbackCurrency,
          display: formatMoney(amount, fallbackCurrency),
          detail: 'custom',
        };
      }
    }
  } else if (effective === 'openai_billing') {
    result = await tryOpenAiBilling();
  } else {
    result = await tryOpenAiBilling();
    if (!result.ok) {
      const ds = await tryDeepSeek();
      if (ds.ok) result = ds;
    }
  }

  if (result.ok) {
    return {
      ok: true,
      label,
      display: result.display,
      amount: result.amount,
      currency: result.currency,
      detail: result.detail || '',
      error: '',
      updatedAt: now,
    };
  }
  return {
    ok: false,
    label,
    display: '',
    amount: null,
    currency: fallbackCurrency,
    detail: '',
    error: result.error || 'parse_error',
    updatedAt: now,
  };
}
