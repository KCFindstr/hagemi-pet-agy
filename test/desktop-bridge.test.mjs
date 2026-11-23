import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DesktopBridge } from '../sidecars/pet/lib/desktop-bridge.mjs';

test('DesktopBridge enforces token auth, blocks traversal on /art, and bridges SSE/POST messages', async () => {
  const received = [];
  const bridge = new DesktopBridge({
    onMessage: (msg, session) => {
      received.push(msg);
      if (msg.type === 'ping') bridge.post(session, { t: 'pong', ok: true });
    },
  });
  const { port, token } = await bridge.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    const unauth = await fetch(`${base}/`);
    assert.equal(unauth.status, 403);

    const badArt = await fetch(`${base}/art?token=${token}&name=${encodeURIComponent('../main')}`);
    assert.equal(badArt.status, 404);

    const goodArt = await fetch(`${base}/art?token=${token}&name=idle`);
    assert.equal(goodArt.status, 200);
    assert.ok((await goodArt.text()).length > 100);

    const rendererRes = await fetch(`${base}/renderer.js?token=${token}`);
    assert.equal(rendererRes.status, 200);
    const js = await rendererRes.text();
    assert.match(js, /desktop: true/);

    const ac = new AbortController();
    const sse = await fetch(`${base}/events?token=${token}&client=test1`, { signal: ac.signal });
    assert.equal(sse.status, 200);
    assert.equal(bridge.hasClients(), true);

    const reader = sse.body.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // ": connected"

    const postRes = await fetch(`${base}/msg?token=${token}&client=test1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ping' }),
    });
    assert.equal(postRes.status, 204);
    assert.deepEqual(received, [{ type: 'ping' }]);

    const nextChunk = await reader.read();
    const text = decoder.decode(nextChunk.value);
    assert.match(text, /"t":"pong"/);

    ac.abort();
  } finally {
    await bridge.stop();
  }
});
