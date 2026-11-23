import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractByPath, fetchThirdPartyBalance, formatMoney, normalizeBaseUrl, parseCreditGrants, parseDeepSeekBalance } from '../sidecars/pet/lib/balance.mjs';
import { formatBalanceSpeech, parseQuota } from '../sidecars/pet/lib/quota.mjs';

test('normalizes http/https base URLs and rejects invalid or dangerous schemes', () => {
  assert.equal(normalizeBaseUrl('https://api.deepseek.com/'), 'https://api.deepseek.com');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:3000/v1///'), 'http://127.0.0.1:3000/v1');
  assert.equal(normalizeBaseUrl('file:///etc/passwd'), null);
  assert.equal(normalizeBaseUrl('javascript:alert(1)'), null);
  assert.equal(normalizeBaseUrl('not a url'), null);
  assert.equal(normalizeBaseUrl(''), null);
});

test('extractByPath traverses objects and arrays safely while blocking prototype keys', () => {
  const sample = { data: { balance: '42.5', items: [{ remaining: 12.34 }] } };
  assert.equal(extractByPath(sample, 'data.balance'), '42.5');
  assert.equal(extractByPath(sample, 'data.items.0.remaining'), 12.34);
  assert.equal(extractByPath(sample, 'data.__proto__'), undefined);
  assert.equal(extractByPath(sample, 'constructor.prototype'), undefined);
  assert.equal(extractByPath(sample, 'data.missing'), undefined);
});

test('parses DeepSeek and OpenAI credit_grants payloads', () => {
  assert.deepEqual(
    parseDeepSeekBalance({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '3.20' }, { currency: 'CNY', total_balance: '18.50' }] }),
    { amount: 18.5, currency: '¥', isAvailable: true },
  );
  assert.equal(parseCreditGrants({ total_available: 12.345 }), 12.345);
  assert.equal(parseCreditGrants({ total_granted: 20, total_used: 7.5 }), 12.5);
  assert.equal(formatMoney(18.5, '¥'), '¥18.50');
});

test('fetches DeepSeek balance when provider is auto or deepseek', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    return new Response(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '25.80' }] }), { status: 200 });
  };
  const result = await fetchThirdPartyBalance(
    { provider: 'auto', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/', apiKey: 'sk-secret-123' },
    { fetchFn, now: 1000 },
  );
  assert.equal(calls[0].url, 'https://api.deepseek.com/user/balance');
  assert.equal(calls[0].auth, 'Bearer sk-secret-123');
  assert.deepEqual(result, { ok: true, label: 'DeepSeek', display: '¥25.80', amount: 25.8, currency: '¥', detail: 'DeepSeek', error: '', updatedAt: 1000 });
});

test('falls back from credit_grants to subscription + usage for OpenAI/OneAPI relays', async () => {
  const fetchFn = async url => {
    if (url.endsWith('/dashboard/billing/credit_grants')) return new Response('not found', { status: 404 });
    if (url.endsWith('/dashboard/billing/subscription')) return new Response(JSON.stringify({ hard_limit_usd: 50 }), { status: 200 });
    if (url.includes('/dashboard/billing/usage')) return new Response(JSON.stringify({ total_usage: 1250 }), { status: 200 });
    return new Response('nope', { status: 404 });
  };
  const result = await fetchThirdPartyBalance(
    { provider: 'openai_billing', label: 'Relay', baseUrl: 'https://relay.example.com/v1', apiKey: 'sk-relay', currency: '$' },
    { fetchFn, now: 2000 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.amount, 37.5);
  assert.equal(result.display, '$37.50');
});

test('supports custom_json provider and never leaks apiKey in errors', async () => {
  const fetchFn = async () => {
    throw new Error('request failed for sk-top-secret-key');
  };
  const failed = await fetchThirdPartyBalance(
    { provider: 'custom_json', baseUrl: 'https://relay.example.com/bal', apiKey: 'sk-top-secret-key', jsonPath: 'data.remain' },
    { fetchFn, now: 3000 },
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'network_error');
  assert.equal(JSON.stringify(failed).includes('sk-top-secret-key'), false);

  const ok = await fetchThirdPartyBalance(
    { provider: 'custom_json', label: 'Custom', baseUrl: 'https://relay.example.com/bal', currency: '¥', jsonPath: 'data.remain' },
    { fetchFn: async () => new Response(JSON.stringify({ data: { remain: '99.1' } }), { status: 200 }), now: 4000 },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.display, '¥99.10');
});

test('formatBalanceSpeech summarizes all model groups and optional API balance without dashes', () => {
  const now = Date.parse('2026-11-23T08:00:00Z');
  const buckets = parseQuota({
    groups: [
      { displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.85, resetTime: new Date(now + 3600000).toISOString() }] },
      { displayName: 'Claude and GPT', buckets: [{ bucketId: 'c-5h', window: '5h', remainingFraction: 0.4, resetTime: new Date(now + 3600000).toISOString() }] },
    ],
  }, now);
  const text = formatBalanceSpeech(buckets, { ok: true, label: 'DeepSeek', display: '¥18.50' }, { hud_balance: 'API余额' }, 'zhs');
  assert.match(text, /Gemini Models\(5h\) 85%/);
  assert.match(text, /Claude and GPT\(5h\) 40%/);
  assert.match(text, /DeepSeek ¥18\.50/);
  assert.doesNotMatch(text, /[—–]/);
});
