// Manages the lifecycle of the transparent Electron overlay window.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN_CJS = join(HERE, '..', 'desktop', 'electron-main.cjs');

export function findElectronExecutable({ customPath = '', pluginRoot = resolve(HERE, '..', '..', '..') } = {}) {
  const candidates = [];
  if (typeof customPath === 'string' && customPath.trim()) {
    candidates.push(customPath.trim().replace(/^"(.*)"$/, '$1'));
  }
  if (process.env.HAGEMI_ELECTRON_PATH) {
    candidates.push(process.env.HAGEMI_ELECTRON_PATH);
  }
  if (process.platform === 'win32') {
    candidates.push(join(pluginRoot, 'node_modules', 'electron', 'dist', 'electron.exe'));
    candidates.push(join(pluginRoot, 'node_modules', '.bin', 'electron.cmd'));
  } else if (process.platform === 'darwin') {
    candidates.push(join(pluginRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'));
    candidates.push(join(pluginRoot, 'node_modules', '.bin', 'electron'));
  } else {
    candidates.push(join(pluginRoot, 'node_modules', 'electron', 'dist', 'electron'));
    candidates.push(join(pluginRoot, 'node_modules', '.bin', 'electron'));
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  try {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const out = execFileSync(cmd, ['electron'], { encoding: 'utf8', windowsHide: true, timeout: 2000 }).trim();
    const first = out.split(/\r?\n/).find(line => line.trim() && existsSync(line.trim()));
    if (first) return first.trim();
  } catch {
    // Not on PATH.
  }
  return null;
}

export class DesktopHost {
  constructor({ pluginRoot, onStatus = () => {}, log = () => {} } = {}) {
    this.pluginRoot = pluginRoot;
    this.onStatus = onStatus;
    this.log = log;
    this.child = null;
    this.status = 'idle';
    this.reason = '';
    this.stopping = false;
  }

  setStatus(status, reason = '') {
    this.status = status;
    this.reason = reason;
    this.onStatus({ status, reason });
  }

  async start(url, { customPath = '' } = {}) {
    if (this.child && !this.child.killed) return true;
    const exe = findElectronExecutable({ customPath, pluginRoot: this.pluginRoot });
    if (!exe) {
      this.setStatus('missing', 'electron_not_found');
      this.log('desktop mode: electron executable not found');
      return false;
    }

    this.stopping = false;
    this.setStatus('starting', '');

    const env = { ...process.env };
    // Antigravity's sidecar host sets ELECTRON_RUN_AS_NODE=1; clear it so Electron boots as a GUI app.
    delete env.ELECTRON_RUN_AS_NODE;

    try {
      const child = spawn(exe, [MAIN_CJS, `--url=${url}`, `--parent-pid=${process.pid}`], {
        env,
        windowsHide: false,
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      this.child = child;
      let errText = '';
      child.stderr?.on('data', chunk => {
        if (errText.length < 1024) errText += chunk.toString('utf8');
      });
      child.once('error', err => {
        this.log(`desktop host spawn error: ${err.message}`);
        if (this.child === child) this.child = null;
        if (!this.stopping) this.setStatus('error', err.message);
      });
      child.once('exit', code => {
        if (this.child === child) this.child = null;
        if (!this.stopping) {
          this.log(`desktop host exited (${code})${errText ? `: ${errText.trim().slice(0, 200)}` : ''}`);
          this.setStatus(code === 0 ? 'idle' : 'error', errText.trim().slice(0, 120));
        } else {
          this.setStatus('idle', '');
        }
      });
      this.setStatus('running', '');
      return true;
    } catch (err) {
      this.setStatus('error', err.message);
      return false;
    }
  }

  async stop() {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    if (!child) {
      this.setStatus('idle', '');
      return;
    }
    try { child.stdin?.end(); } catch {}
    await new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      child.once('exit', finish);
      try { child.kill(); } catch {}
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        finish();
      }, 1500).unref?.();
    });
    this.setStatus('idle', '');
  }
}
