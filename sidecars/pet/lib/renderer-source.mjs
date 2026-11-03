// Concatenates the renderer files into the one script that gets injected into the app.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(HERE, '..', 'renderer');
export const ART_DIR = join(HERE, '..', 'art');
const FILES = ['util.js', 'styles.js', 'rig.js', 'fx.js', 'behavior.js', 'pet.js'];

export const BINDING = '__hagemiCall';

export function rendererSource({ standalone = false } = {}) {
  const rigData = readFileSync(join(ART_DIR, 'rig.json'), 'utf8');
  const body = FILES.map(file => readFileSync(join(RENDERER, file), 'utf8')).join('\n');
  const version = createHash('sha256').update(body + rigData).digest('hex').slice(0, 16);
  // Runs in an isolated world, so these names never touch the app's own globals.
  const source = `(async () => {
    'use strict';
    if (window !== window.top) return;
    if (window.__hagemiPet) { window.__hagemiPet.dispose(); window.__hagemiPet = null; }
    const HAGEMI = { rigData: ${rigData} };
${body}
    const send = message => { try { window.${BINDING}(JSON.stringify(message)); } catch {} };
    window.__hagemiPet = await HAGEMI.boot(send, { standalone: ${standalone} });
  })().catch(error => { try { window.${BINDING}(JSON.stringify({ type: 'error', message: String(error && error.stack || error).slice(0, 800) })); } catch {} });`;
  return { source, version };
}

// Art is requested by name from the renderer, so the name is untrusted input.
const ART_NAME = /^(?:blink\/)?[a-z0-9_-]{1,32}$/;
export function readArt(name) {
  if (typeof name !== 'string' || !ART_NAME.test(name)) return null;
  try {
    return readFileSync(normalize(join(ART_DIR, `${name}.webp`))).toString('base64');
  } catch {
    return null;
  }
}
