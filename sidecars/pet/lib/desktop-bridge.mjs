// Loopback HTTP + SSE bridge for the standalone transparent desktop overlay window.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readArt, rendererSource } from './renderer-source.mjs';

const MAX_BODY_BYTES = 128 * 1024;

function tokenMatch(expected, actual) {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export class DesktopBridge {
  constructor({
    onMessage = () => {},
    onConnectionChange = () => {},
    log = () => {},
    host = '127.0.0.1',
    port = 0,
    readArtFn = readArt,
    rendererSourceFn = rendererSource,
  } = {}) {
    this.onMessage = onMessage;
    this.onConnectionChange = onConnectionChange;
    this.log = log;
    this.host = host;
    this.requestedPort = port;
    this.readArt = readArtFn;
    this.rendererSource = rendererSourceFn;
    this.token = randomBytes(24).toString('hex');
    this.sessions = new Map();
    this.server = null;
    this.port = 0;
    this.nextClientId = 1;
  }

  hasClients() {
    for (const session of this.sessions.values()) {
      if (!session.closed) return true;
    }
    return false;
  }

  url() {
    if (!this.port) return '';
    return `http://${this.host}:${this.port}/?token=${this.token}`;
  }

  start() {
    if (this.server) return Promise.resolve({ port: this.port, token: this.token, url: this.url() });
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handleRequest(req, res));
      server.once('error', reject);
      server.listen(this.requestedPort, this.host, () => {
        server.removeListener('error', reject);
        this.server = server;
        this.port = server.address().port;
        resolve({ port: this.port, token: this.token, url: this.url() });
      });
    });
  }

  async stop() {
    for (const session of this.sessions.values()) {
      clearInterval(session.ping);
      session.closed = true;
      try { session.res.end(); } catch {}
    }
    this.sessions.clear();
    this.onConnectionChange(0);
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.port = 0;
    await new Promise(resolve => {
      server.close(() => resolve());
      setTimeout(resolve, 1000).unref?.();
    });
  }

  post(session, message) {
    if (!session || session.closed || !session.res || session.res.writableEnded) return;
    try {
      session.res.write(`data: ${JSON.stringify(message)}\n\n`);
    } catch {
      session.closed = true;
    }
  }

  broadcast(message) {
    for (const session of this.sessions.values()) {
      if (session.ready && !session.closed) this.post(session, message);
    }
  }

  buildHtml() {
    const clientId = `c${this.nextClientId++}`;
    const t = JSON.stringify(this.token);
    const cid = JSON.stringify(clientId);
    return `<!doctype html><html><head><meta charset="utf-8"><title>Hagemi Desktop</title>
<style>
html, body { margin: 0; padding: 0; width: 100vw; height: 100vh; overflow: hidden; background: transparent !important; }
</style></head><body>
<script>
(() => {
  const TOKEN = ${t};
  const CLIENT_ID = ${cid};
  const pending = [];
  window.__hagemiCall = (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg && msg.type === 'hit') {
      try { window.__hagemiDesktop?.setInteractive(!!msg.interactive); } catch {}
      return;
    }
    if (msg && msg.type === 'art') {
      fetch('/art?token=' + encodeURIComponent(TOKEN) + '&name=' + encodeURIComponent(msg.name || ''))
        .then(r => r.ok ? r.text() : '')
        .then(data => {
          const payload = { t: 'art', name: msg.name, data: data || null };
          if (window.__hagemiPet) window.__hagemiPet.receive(payload);
          else pending.push(payload);
        })
        .catch(() => {
          const payload = { t: 'art', name: msg.name, data: null };
          if (window.__hagemiPet) window.__hagemiPet.receive(payload);
          else pending.push(payload);
        });
      return;
    }
    fetch('/msg?token=' + encodeURIComponent(TOKEN) + '&client=' + encodeURIComponent(CLIENT_ID), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw
    }).catch(() => {});
  };
  const es = new EventSource('/events?token=' + encodeURIComponent(TOKEN) + '&client=' + encodeURIComponent(CLIENT_ID));
  es.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (window.__hagemiPet) {
      while (pending.length) window.__hagemiPet.receive(pending.shift());
      window.__hagemiPet.receive(msg);
    } else {
      pending.push(msg);
    }
  };
  window.__hagemiDesktopDrain = () => {
    if (!window.__hagemiPet) return;
    while (pending.length) window.__hagemiPet.receive(pending.shift());
  };
})();
</script>
<script src="/renderer.js?token=${encodeURIComponent(this.token)}"></script>
<script>window.__hagemiDesktopDrain && window.__hagemiDesktopDrain();</script>
</body></html>`;
  }

  handleRequest(req, res) {
    const parsed = new URL(req.url || '/', `http://${this.host}`);
    if (!tokenMatch(this.token, parsed.searchParams.get('token'))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(this.buildHtml());
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/renderer.js') {
      const { source } = this.rendererSource({ standalone: false, desktop: true });
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(source);
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/art') {
      const name = parsed.searchParams.get('name') || '';
      const data = this.readArt(name);
      if (!data) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'max-age=600' });
      res.end(data);
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/events') {
      const clientId = parsed.searchParams.get('client') || `c${this.nextClientId++}`;
      const existing = this.sessions.get(clientId);
      if (existing) {
        clearInterval(existing.ping);
        existing.closed = true;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      const session = {
        id: clientId,
        desktop: true,
        res,
        ready: false,
        closed: false,
        ping: setInterval(() => {
          if (!session.closed && !res.writableEnded) {
            try { res.write(': ping\n\n'); } catch {}
          }
        }, 25000),
      };
      session.ping.unref?.();
      this.sessions.set(clientId, session);
      this.onConnectionChange(this.sessions.size);
      req.on('close', () => {
        clearInterval(session.ping);
        session.closed = true;
        if (this.sessions.get(clientId) === session) {
          this.sessions.delete(clientId);
          this.onConnectionChange(this.sessions.size);
        }
      });
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/msg') {
      const clientId = parsed.searchParams.get('client') || '';
      let bytes = 0;
      const chunks = [];
      let aborted = false;
      req.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) {
          aborted = true;
          res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Payload too large');
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (aborted) return;
        let msg;
        try {
          msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Bad JSON');
          return;
        }
        const session = this.sessions.get(clientId) || [...this.sessions.values()].find(s => !s.closed) || null;
        if (session && msg?.type === 'ready') session.ready = true;
        res.writeHead(204);
        res.end();
        if (session) this.onMessage(msg, session);
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}
