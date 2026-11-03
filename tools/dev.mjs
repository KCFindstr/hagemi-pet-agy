#!/usr/bin/env node
// Runs the sidecar against a running Antigravity without installing anything, for development.
// Settings and the token tally go to .dev-data/ so they never mix with an installed copy.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, ['main.mjs'], {
  cwd: join(ROOT, 'sidecars', 'pet'),
  stdio: 'inherit',
  env: { ...process.env, HAGEMI_DEBUG: '1', ANTIGRAVITY_EXECUTABLE_DATA_DIR: join(ROOT, '.dev-data') },
});
child.on('exit', code => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
