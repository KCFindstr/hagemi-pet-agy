import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runGit, Updater, UPDATE_REPO } from '../sidecars/pet/lib/updater.mjs';

const sha = c => c.repeat(40);
function fake({ current = sha('a'), latest = sha('b'), status = 'ahead', dirty = false, installed = true, fetchFn, gitFn } = {}) {
  const calls = [], root = join(tmpdir(), 'hagemi-updater-unit');
  let restarted = 0;
  const git = async (path, args) => {
    calls.push(args);
    if (gitFn) return gitFn(path, args);
    if (args[0] === 'rev-parse') return args[1] === '--show-toplevel' ? root : current;
    if (args[0] === 'status') return dirty ? ' M plugin.json' : '';
    return '';
  };
  const fetchDefault = async url => ({ ok: true, json: async () => url.includes('/compare/') ? { status } : { sha: latest } });
  const updater = new Updater({ root, installedRoot: installed ? root : join(root, 'other'), git, fetchFn: fetchFn || fetchDefault, onInstalled: () => restarted++ });
  return { updater, calls, get restarted() { return restarted; } };
}

test('new commits are offered even when the version did not change', async () => {
  const { updater } = fake();
  assert.equal((await updater.check()).phase, 'available');
  assert.equal(updater.state.canInstall, true);
});

test('identical commits and local commits ahead of main are already current', async () => {
  assert.equal((await fake({ latest: sha('a') }).updater.check()).phase, 'current');
  assert.equal((await fake({ status: 'behind' }).updater.check()).phase, 'current');
});

test('dirty, divergent and development copies cannot install', async () => {
  for (const [options, reason] of [[{ dirty: true }, 'local_changes'], [{ status: 'diverged' }, 'diverged'], [{ installed: false }, 'checkout']]) {
    const { updater, calls } = fake(options);
    await updater.check();
    assert.equal(updater.state.reason, reason);
    assert.equal(updater.state.canInstall, false);
    await updater.install();
    assert.ok(!calls.some(args => args[0] === 'fetch'));
  }
});

test('a copied folder never updates its parent repository', async () => {
  const { updater } = fake({ gitFn: async () => tmpdir() });
  await updater.check();
  assert.equal(updater.state.reason, 'no_git');
  assert.equal(updater.state.phase, 'manual');
  assert.equal(updater.state.canInstall, false);
});

test('network failures, rate limits and malformed commit hashes leave the pet usable', async () => {
  for (const [fetchFn, reason] of [
    [async () => { throw new Error('offline'); }, 'network'],
    [async () => ({ ok: false, status: 429 }), 'rate_limited'],
    [async () => ({ ok: true, json: async () => ({ sha: '--bad-option' }) }), 'network'],
  ]) {
    const { updater } = fake({ fetchFn });
    assert.equal((await updater.check()).phase, 'error');
    assert.equal(updater.state.reason, reason);
  }
});

test('concurrent checks share a request and successful checks are briefly cached', async () => {
  let requests = 0;
  const { updater } = fake({ latest: sha('a'), fetchFn: async () => { requests++; return { ok: true, json: async () => ({ sha: sha('a') }) }; } });
  await Promise.all([updater.check(), updater.check(), updater.check()]);
  await updater.check();
  assert.equal(requests, 1);
});

test('failed checks can be retried immediately', async () => {
  let requests = 0;
  const { updater } = fake({ fetchFn: async () => { requests++; throw new Error('offline'); } });
  await updater.check();
  await updater.check();
  assert.equal(requests, 2);
});

// Exercise real Git in temporary repositories: update exact files, retain settings, and refuse
// edits made after checking. Only the public fetch is redirected to our local test upstream.
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hagemi-update-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const upstream = join(dir, 'upstream'), root = join(dir, 'installed'), data = join(dir, 'data');
  mkdirSync(upstream); mkdirSync(data);
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(upstream, 'init', '-b', 'main');
  git(upstream, 'config', 'user.name', 'Hagemi Test');
  git(upstream, 'config', 'user.email', 'hagemi@example.invalid');
  writeFileSync(join(upstream, 'plugin.json'), JSON.stringify({ name: 'hagemi-pet-agy', version: '0.1.1' }));
  writeFileSync(join(upstream, 'pet.txt'), 'old paws');
  git(upstream, 'add', '.'); git(upstream, 'commit', '-m', 'Initial');
  git(dir, 'clone', upstream, root);
  const initial = git(root, 'rev-parse', 'HEAD');
  writeFileSync(join(upstream, 'pet.txt'), 'fresh paws');
  git(upstream, 'commit', '-am', 'Fresh paws, same version');
  const latest = git(upstream, 'rev-parse', 'HEAD');
  writeFileSync(join(data, 'settings.json'), '{"language":"zhs"}');
  let restarted = 0, fetches = 0;
  const updater = new Updater({
    root, installedRoot: root,
    git: (cwd, args) => {
      if (args[0] === 'fetch') { assert.equal(args[2], UPDATE_REPO); assert.equal(args[3], latest); args = [...args]; args[2] = upstream; fetches++; }
      return runGit(cwd, args);
    },
    fetchFn: async url => ({ ok: true, json: async () => url.includes('/compare/') ? { status: 'ahead' } : { sha: latest } }),
    onInstalled: () => restarted++,
  });
  return { updater, root, data, git, initial, latest, get restarted() { return restarted; }, get fetches() { return fetches; } };
}

test('a real update fast-forwards once, preserves settings and asks the host to restart', async t => {
  const f = fixture(t);
  await f.updater.check();
  assert.equal(f.updater.state.currentVersion, '0.1.1');
  await Promise.all([f.updater.install(), f.updater.install()]);
  assert.equal(f.updater.state.phase, 'installed');
  assert.equal(f.git(f.root, 'rev-parse', 'HEAD'), f.latest);
  assert.equal(readFileSync(join(f.root, 'pet.txt'), 'utf8'), 'fresh paws');
  assert.equal(readFileSync(join(f.data, 'settings.json'), 'utf8'), '{"language":"zhs"}');
  assert.equal(f.restarted, 1);
  assert.equal(f.fetches, 1);
  assert.equal((await f.updater.check()).phase, 'installed');
});

test('edits made after a check are preserved, and a later check can recover', async t => {
  const f = fixture(t);
  await f.updater.check();
  writeFileSync(join(f.root, 'pet.txt'), 'my paws');
  await f.updater.install();
  assert.equal(f.updater.state.reason, 'local_changes');
  assert.equal(f.git(f.root, 'rev-parse', 'HEAD'), f.initial);
  assert.equal(readFileSync(join(f.root, 'pet.txt'), 'utf8'), 'my paws');
  assert.equal(f.restarted, 0);
  f.git(f.root, 'restore', 'pet.txt');
  await f.updater.check();
  assert.equal(f.updater.state.canInstall, true);
});

test('a commit made after checking cannot be reset to upstream', async t => {
  const f = fixture(t);
  await f.updater.check();
  writeFileSync(join(f.root, 'custom.txt'), 'my own work');
  f.git(f.root, 'add', '.');
  f.git(f.root, '-c', 'user.name=Hagemi Test', '-c', 'user.email=hagemi@example.invalid', 'commit', '-m', 'Custom work');
  const custom = f.git(f.root, 'rev-parse', 'HEAD');
  await f.updater.install();
  assert.equal(f.updater.state.reason, 'diverged');
  assert.equal(f.git(f.root, 'rev-parse', 'HEAD'), custom);
  assert.equal(readFileSync(join(f.root, 'custom.txt'), 'utf8'), 'my own work');
  assert.equal(f.restarted, 0);
});

test('failed fetching leaves the installed revision intact', async t => {
  const f = fixture(t);
  await f.updater.check();
  const git = f.updater.git;
  f.updater.git = args => args[0] === 'fetch' ? Promise.reject(new Error('offline')) : git(args);
  await f.updater.install();
  assert.equal(f.updater.state.phase, 'error');
  assert.equal(f.updater.state.reason, 'install_failed');
  assert.equal(f.git(f.root, 'rev-parse', 'HEAD'), f.initial);
  assert.equal(f.restarted, 0);
});
