// Source-only updates from the public upstream. Git does the final fast-forward, so local work
// and divergent history are never replaced. Nothing is installed by a background check.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const UPDATE_REPO = 'https://github.com/KCFindstr/hagemi-pet-agy.git';
const API = 'https://api.github.com/repos/KCFindstr/hagemi-pet-agy';
const SHA = /^[a-f0-9]{40}$/;
export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function runGit(root, args) {
  const { stdout } = await exec('git', ['-C', root, ...args], {
    windowsHide: true, timeout: 120000, maxBuffer: 1 << 20,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no' },
  });
  return stdout.trim();
}

export class Updater {
  constructor({ root, installedRoot, git = runGit, fetchFn = fetch, onChange = () => {}, onInstalled = () => {}, log = () => {} }) {
    this.root = resolve(root);
    this.isInstalled = this.root === resolve(installedRoot);
    this.git = args => git(this.root, args);
    this.fetch = fetchFn;
    this.onChange = onChange;
    this.onInstalled = onInstalled;
    this.log = log;
    this.state = { phase: 'idle', currentVersion: '', currentSha: '', latestSha: '', canInstall: false, reason: '' };
    this.pending = null;
    this.checkedAt = 0;
  }

  publish(change) {
    this.state = { ...this.state, ...change };
    this.onChange(this.state);
    return this.state;
  }

  async local() {
    try { this.state.currentVersion = JSON.parse(await readFile(resolve(this.root, 'plugin.json'), 'utf8')).version || ''; } catch {}
    try {
      // A copied plugin must not accidentally find a parent checkout and update that instead.
      const top = await this.git(['rev-parse', '--show-toplevel']);
      if (resolve(top) !== this.root) throw new Error('not the plugin checkout');
      const sha = await this.git(['rev-parse', 'HEAD']);
      if (!SHA.test(sha)) throw new Error('invalid local commit');
      const dirty = !!await this.git(['status', '--porcelain', '--untracked-files=all']);
      return { currentSha: sha, canInstall: this.isInstalled && !dirty, reason: !this.isInstalled ? 'checkout' : dirty ? 'local_changes' : '' };
    } catch {
      return { currentSha: '', canInstall: false, reason: this.isInstalled ? 'no_git' : 'checkout' };
    }
  }

  async json(url) {
    const response = await this.fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Hagemi-Pet-Updater' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'rate_limited' : 'network');
    return response.json();
  }

  check() {
    if (this.pending) return this.pending;
    if (this.state.phase === 'installed') return Promise.resolve(this.state);
    // Coalesce clicks across app windows and avoid spending GitHub's anonymous rate limit.
    if (['current', 'available'].includes(this.state.phase) && this.state.canInstall && this.checkedAt && Date.now() - this.checkedAt < 60000) return Promise.resolve(this.state);
    this.pending = this.checkNow().finally(() => { this.pending = null; });
    return this.pending;
  }

  async checkNow() {
    this.publish({ phase: 'checking' });
    try {
      const local = await this.local();
      const latest = await this.json(`${API}/commits/main`);
      if (!SHA.test(latest.sha)) throw new Error('network');
      let phase = local.currentSha ? 'available' : 'manual';
      if (local.currentSha === latest.sha) phase = 'current';
      else if (local.currentSha) {
        // A different hash could also be a newer local commit or a separate branch.
        const comparison = await this.json(`${API}/compare/${local.currentSha}...${latest.sha}`);
        if (comparison.status === 'behind' || comparison.status === 'identical') phase = 'current';
        else if (comparison.status === 'diverged') { local.canInstall = false; local.reason = 'diverged'; }
        else if (comparison.status !== 'ahead') throw new Error('network');
      }
      this.checkedAt = Date.now();
      return this.publish({ ...local, phase, latestSha: latest.sha });
    } catch (error) {
      this.log(`update check: ${error.message}`);
      return this.publish({ phase: 'error', reason: error.message === 'rate_limited' ? 'rate_limited' : 'network', canInstall: false });
    }
  }

  install() {
    if (this.pending) return this.pending;
    if (this.state.phase !== 'available' || !this.state.canInstall || !SHA.test(this.state.latestSha)) return Promise.resolve(this.state);
    this.pending = this.installNow().finally(() => { this.pending = null; });
    return this.pending;
  }

  async installNow() {
    const target = this.state.latestSha;
    this.publish({ phase: 'installing' });
    try {
      const local = await this.local();
      if (!local.canInstall) return this.publish({ ...local, phase: 'available' });
      // Fetch the exact reviewed commit from the fixed upstream, never an editable remote URL.
      await this.git(['fetch', '--no-tags', UPDATE_REPO, target]);
      if (await this.git(['status', '--porcelain', '--untracked-files=all'])) return this.publish({ phase: 'available', reason: 'local_changes', canInstall: false });
      try { await this.git(['merge-base', '--is-ancestor', 'HEAD', target]); }
      catch { return this.publish({ phase: 'available', reason: 'diverged', canInstall: false }); }
      await this.git(['-c', `core.hooksPath=${resolve(this.root, '.git', 'hagemi-no-hooks')}`, 'merge', '--ff-only', '--no-edit', target]);
      if (await this.git(['rev-parse', 'HEAD']) !== target) throw new Error('update did not reach the requested commit');
      const state = this.publish({ phase: 'installed', currentSha: target, canInstall: false, reason: '' });
      this.onInstalled();
      return state;
    } catch (error) {
      this.log(`update install: ${error.message}`);
      this.checkedAt = 0;
      return this.publish({ phase: 'error', reason: 'install_failed', canInstall: false });
    }
  }
}
