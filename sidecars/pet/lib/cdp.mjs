// Puts her into the app window. Antigravity opens a Chrome DevTools port for itself (its browser
// tools use it) and records it in DevToolsActivePort; this attaches to the app's own page on that
// loopback port. Nothing on disk is patched, so app updates cannot be broken by it.
// The script runs in an isolated world: it shares the DOM but cannot touch the app's JavaScript.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BINDING, rendererSource } from './renderer-source.mjs';

const WORLD = 'hagemi-pet';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function profileDirectory({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (env.HAGEMI_PROFILE_DIR) return env.HAGEMI_PROFILE_DIR;
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Antigravity');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Antigravity');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Antigravity');
}

// Only the app's main window: a top-level page served from its loopback origin. Agent browser
// tabs and plugin iframes never qualify.
export function isAppWindow(target, port) {
  try {
    const page = new URL(target.url), socket = new URL(target.webSocketDebuggerUrl);
    return target.type === 'page' && ['http:', 'https:'].includes(page.protocol) && LOOPBACK.has(page.hostname)
      && page.pathname === '/' && socket.protocol === 'ws:' && LOOPBACK.has(socket.hostname) && Number(socket.port) === port;
  } catch {
    return false;
  }
}

class Session {
  constructor(url, onEvent, onClose) {
    this.url = url; this.onEvent = onEvent; this.onClose = onClose;
    this.pending = new Map(); this.nextId = 0; this.closed = false;
    this.contextId = null; this.mounted = false; this.ready = false;
  }
  open(timeout = 5000) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const timer = setTimeout(() => { socket.close(); reject(new Error('renderer connection timed out')); }, timeout);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(this); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('renderer connection failed')); }, { once: true });
      socket.addEventListener('close', () => this.dispose());
      socket.addEventListener('message', event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.id) {
          const item = this.pending.get(message.id);
          if (!item) return;
          this.pending.delete(message.id);
          clearTimeout(item.timer);
          if (message.error) item.reject(new Error(`${item.method}: ${message.error.message}`));
          else item.resolve(message.result || {});
        } else if (message.method) this.onEvent(this, message);
      });
    });
  }
  command(method, params = {}, timeout = 8000) {
    if (this.closed || this.socket?.readyState !== 1) return Promise.reject(new Error('renderer disconnected'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('renderer disconnected')); }
    this.pending.clear();
    this.onClose(this);
  }
  close() { this.dispose(); try { this.socket?.close(); } catch { /* Already gone. */ } }
}

export class RendererBridge {
  constructor({ onMessage, log = () => {}, profile = profileDirectory(), interval = 3000 }) {
    Object.assign(this, { onMessage, log, profile, interval });
    this.sessions = new Map();
    this.source = rendererSource().source;
    this.health = { state: 'waiting', windows: 0 };
  }

  async targets() {
    const text = await readFile(join(this.profile, 'DevToolsActivePort'), 'utf8');
    const port = Number(text.split(/\r?\n/)[0]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid DevToolsActivePort');
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2500) });
    const list = await response.json();
    return list.filter(target => isAppWindow(target, port));
  }

  async attach(target) {
    const session = new Session(target.webSocketDebuggerUrl, (s, message) => this.handleEvent(s, message), s => {
      if (this.sessions.get(s.url) === s) this.sessions.delete(s.url);
    });
    await session.open();
    session.origin = new URL(target.url).origin;
    await session.command('Page.enable');
    await session.command('Runtime.enable');
    await this.mount(session);
    return session;
  }

  // A fresh isolated world per document. The binding delivers her messages to this process.
  async mount(session) {
    const tree = await session.command('Page.getFrameTree');
    const frameId = tree.frameTree?.frame?.id;
    if (!frameId) throw new Error('no main frame');
    const world = await session.command('Page.createIsolatedWorld', { frameId, worldName: WORLD, grantUniveralAccess: false });
    session.contextId = world.executionContextId;
    session.ready = false;
    await session.command('Runtime.addBinding', { name: BINDING, executionContextName: WORLD });
    const result = await session.command('Runtime.evaluate', { expression: this.source, contextId: session.contextId, awaitPromise: false }, 20000);
    if (result.exceptionDetails) throw new Error(`pet failed to start: ${result.exceptionDetails.text}`);
    session.mounted = true;
  }

  handleEvent(session, { method, params }) {
    if (method === 'Runtime.bindingCalled' && params.name === BINDING) {
      if (params.executionContextId !== session.contextId || typeof params.payload !== 'string' || params.payload.length > 65536) return;
      let message;
      try { message = JSON.parse(params.payload); } catch { return; }
      if (message.type === 'ready') session.ready = true;
      this.onMessage(message, session);
    } else if (method === 'Runtime.executionContextDestroyed' && params.executionContextId === session.contextId) {
      session.contextId = null;
      session.mounted = false;
      session.ready = false;
    } else if (method === 'Runtime.executionContextsCleared' || (method === 'Page.frameNavigated' && !params.frame?.parentId)) {
      session.contextId = null;
      session.mounted = false;
      session.ready = false;
    }
  }

  // Next tick mounts a fresh pet; used when the WebGL context dies under her.
  remount(session) {
    session.contextId = null;
    session.mounted = false;
    session.ready = false;
  }

  post(session, message) {
    if (!session.contextId || session.closed) return;
    const expression = `window.__hagemiPet && window.__hagemiPet.receive(${JSON.stringify(message)})`;
    session.command('Runtime.evaluate', { expression, contextId: session.contextId }).catch(() => {});
  }

  broadcast(message) {
    for (const session of this.sessions.values()) if (session.ready) this.post(session, message);
  }

  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const targets = await this.targets();
      const urls = new Set(targets.map(t => t.webSocketDebuggerUrl));
      for (const [url, session] of this.sessions) if (!urls.has(url)) session.close();
      for (const target of targets) {
        const session = this.sessions.get(target.webSocketDebuggerUrl);
        if (session) continue;
        const attached = await this.attach(target);
        this.sessions.set(target.webSocketDebuggerUrl, attached);
      }
      for (const session of this.sessions.values()) {
        if (session.closed) continue;
        if (!session.contextId) await this.mount(session);
      }
      this.health = { state: this.sessions.size ? 'mounted' : 'waiting', windows: this.sessions.size };
    } catch (error) {
      if (this.health.state !== 'retrying') this.log(`renderer: ${error.message}`);
      this.health = { state: 'retrying', windows: this.sessions.size, message: error.message };
    } finally {
      this.busy = false;
    }
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.interval);
    this.timer.unref?.();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const session of this.sessions.values()) {
      try {
        // Same DOM across worlds, so removal works even if she is mid-animation.
        await session.command('Runtime.evaluate', { expression: `window.__hagemiPet && window.__hagemiPet.dispose()`, contextId: session.contextId });
      } catch { /* The window may already be gone. */ }
      session.close();
    }
    this.sessions.clear();
  }
}
