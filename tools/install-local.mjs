#!/usr/bin/env node
// Installs this checkout into Antigravity, or removes it with --uninstall.
// Copies only what the plugin needs into ~/.gemini/config/plugins/hagemi-pet-agy, then enables it
// through the running app when there is one, since writes behind its back are missed until restart.
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LanguageServer } from '../sidecars/pet/lib/ls-client.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'hagemi-pet-agy', SIDECAR = `${NAME}/pet`;
const CONFIG_DIR = join(homedir(), '.gemini', 'config');
const TARGET = join(CONFIG_DIR, 'plugins', NAME);
const PAYLOAD = ['plugin.json', 'README.md', 'README.zh-CN.md', 'LICENSE', 'NOTICE.md', 'assets', 'sidecars'];
const uninstall = process.argv.includes('--uninstall');

async function setEnabled(enabled) {
  const change = { plugins: { [NAME]: { enabled } }, sidecars: { [SIDECAR]: { enabled } } };
  try {
    const ls = new LanguageServer();
    await ls.call('JetboxWriteState', { userConfig: change });
    return 'running app';
  } catch {
    // App closed: nobody to race with, so write the config file directly.
    const file = join(CONFIG_DIR, 'config.json');
    const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    config.plugins = { ...config.plugins, ...change.plugins };
    config.sidecars = { ...config.sidecars, [SIDECAR]: { ...config.sidecars?.[SIDECAR], enabled } };
    mkdirSync(CONFIG_DIR, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
    renameSync(temporary, file);
    return 'config file';
  }
}

// Stops a running copy, so its files can be replaced.
async function stopRunning() {
  const ls = new LanguageServer();
  try {
    await ls.call('JetboxWriteState', { userConfig: { sidecars: { [SIDECAR]: { enabled: false } } } });
    for (let attempt = 0; attempt < 30; attempt++) {
      const { sidecars = [] } = await ls.call('GetSidecars');
      const mine = sidecars.find(sidecar => sidecar.sidecarId === SIDECAR);
      if (!mine || mine.status !== 'SIDECAR_STATUS_RUNNING') return;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch { /* App closed, so nothing is running. */ }
}

const removeTarget = () => rmSync(TARGET, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });

if (uninstall) {
  await stopRunning();
  try {
    await new LanguageServer().call('DeletePlugin', { pluginId: NAME });
  } catch { /* App closed; removing the folder below is all that is needed. */ }
  removeTarget();
  // Back to the default state: a stale "disabled" entry would haunt a later reinstall.
  await setEnabled(true).catch(() => {});
  console.log('Hagemi is uninstalled. She will wave goodbye within a minute or two.');
  console.log('Her settings stay in ~/.gemini/antigravity/sidecar_data/hagemi-pet-agy/ in case she comes back.');
  process.exit(0);
}

if (existsSync(TARGET)) {
  await stopRunning();
  removeTarget();
}
mkdirSync(TARGET, { recursive: true });
for (const item of PAYLOAD) {
  if (existsSync(join(ROOT, item))) cpSync(join(ROOT, item), join(TARGET, item), { recursive: true });
}
const via = await setEnabled(true);
console.log(`Installed to ${TARGET} and enabled through the ${via}.`);
console.log(via === 'running app'
  ? 'Hagemi should appear in the bottom right within about 30 seconds. If she does not, restart Antigravity once.'
  : 'Hagemi appears in the bottom right the next time you open Antigravity.');
