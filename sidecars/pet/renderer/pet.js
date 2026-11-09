// The pet's presence on screen: stage, pose loading, drag and throw, petting, bubble, menu and
// the bridge to the sidecar. It all lives in a closed shadow root so the app's UI is untouched.
HAGEMI.boot = async function boot(send, options = {}) {
  const { clamp, lerp, rand } = HAGEMI.util;
  const { STAGE, MARGIN } = HAGEMI;
  const SIZES = { xs: 130, s: 175, m: 225, l: 295, xl: 380 };
  const HOST_ID = 'hagemi-pet-host';
  const FADE_MS = 120;
  const POSE_CACHE = 10;

  document.getElementById(HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000;';
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(HAGEMI.css);
  root.adoptedStyleSheets = [sheet];

  const make = (tag, className, parent = root) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    parent.appendChild(element);
    return element;
  };
  const stage = make('div', 'stage');
  const backCanvas = make('canvas', 'layer', stage);
  const glCanvas = make('canvas', 'layer', stage);
  const frontCanvas = make('canvas', 'layer', stage);
  const hit = make('div', 'hit', stage);
  const bubble = make('div', 'bubble');
  const bubbleMark = make('span', 'mark', bubble);
  const bubbleText = make('span', 'text', bubble);
  const hud = make('div', 'hud');
  const menu = make('div', 'menu');
  menu.setAttribute('role', 'menu');
  const panel = make('div', 'panel');
  panel.setAttribute('role', 'dialog');

  let leaving = 0, running = true;
  const rig = HAGEMI.createRig(glCanvas, () => { if (running) { dispose(); send({ type: 'remount' }); } });
  if (!rig) { send({ type: 'error', message: 'webgl2-unavailable' }); return null; }
  const fx = HAGEMI.createFx(backCanvas, frontCanvas);
  const animator = HAGEMI.createAnimator(fx);

  let settings = { language: 'en', size: 'm', hidden: false, muted: false, animation: 'balanced', followCursor: true, position: null };
  let ui = {};
  let hudRows = [];
  let scale = 0, pixelRatio = 0, spriteW = 0, spriteH = 0;
  let x = 0, y = 0, vx = 0, vy = 0;
  let dragging = null;
  const abort = new AbortController();
  const listen = (target, type, handler, extra = {}) => target.addEventListener(type, handler, { signal: abort.signal, ...extra });

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  animator.setReducedMotion(reducedMotion.matches);
  listen(reducedMotion, 'change', () => animator.setReducedMotion(reducedMotion.matches));

  // ---- Art: requested over the sidecar bridge, one pose at a time --------------------------
  const blobs = new Map(), pendingArt = new Map(), poses = new Map(), building = new Map();
  let current = null, previous = null, fade = 1, fadeStart = 0, wantedPose = null;

  function requestArt(name) {
    if (blobs.has(name)) return Promise.resolve(blobs.get(name));
    if (pendingArt.has(name)) return pendingArt.get(name).promise;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    pendingArt.set(name, { promise, resolve });
    send({ type: 'art', name });
    return promise;
  }
  function receiveArt(name, data) {
    const entry = pendingArt.get(name);
    let blob = null;
    if (data) {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      blob = new Blob([bytes], { type: 'image/webp' });
      blobs.set(name, blob);
    }
    pendingArt.delete(name);
    entry?.resolve(blob);
  }
  const decode = blob => createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });

  async function ensurePose(name) {
    if (poses.has(name)) return poses.get(name);
    if (building.has(name)) return building.get(name);
    const job = (async () => {
      const info = HAGEMI.rigData[name];
      if (!info) return null;
      const files = await Promise.all([
        requestArt(name),
        info.blink ? requestArt(`blink/${name}`) : null,
        ...['tail', 'under', 'cut'].map(layer => (info.tailRect ? requestArt(`${layer}/${name}`) : null)),
      ]);
      if (!files[0] || !running) return null;
      const layers = await Promise.all(files.map(blob => (blob ? decode(blob) : null)));
      const pose = rig.buildPose(name, ...layers, info);
      for (const layer of layers) layer?.close();
      poses.set(name, pose);
      // Keep only the poses in recent use on the GPU; the compressed art stays in memory.
      if (poses.size > POSE_CACHE) for (const [other, value] of poses) {
        if (value !== current && value !== previous && other !== wantedPose) { rig.freePose(value); poses.delete(other); break; }
      }
      return pose;
    })().finally(() => building.delete(name));
    building.set(name, job);
    return job;
  }
  async function preloadClones() {
    const art = await requestArt('idle');
    if (!art || !running) return;
    fx.setCloneImage(await createImageBitmap(art, { resizeWidth: 222, resizeHeight: 256, resizeQuality: 'high' }));
  }
  function usePose(name) {
    if (wantedPose === name || !name) return;
    wantedPose = name;
    ensurePose(name).then(pose => {
      if (!pose || wantedPose !== name || current === pose) return;
      previous = current;
      current = pose;
      fade = previous ? 0 : 1;
      fadeStart = performance.now();
      if (previous) animator.play('pop');
    });
  }

  function applySize() {
    const height = SIZES[settings.size] || SIZES.m;
    scale = height / STAGE.h;
    pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    spriteW = 500 * scale;
    spriteH = height;
    const cssW = (STAGE.w + MARGIN * 2) * scale, cssH = (STAGE.h + MARGIN * 2) * scale;
    const pixelW = Math.round(cssW * pixelRatio), pixelH = Math.round(cssH * pixelRatio);
    stage.style.width = `${cssW}px`;
    stage.style.height = `${cssH}px`;
    hit.style.left = `${MARGIN * scale}px`;
    hit.style.top = `${MARGIN * scale}px`;
    hit.style.width = `${STAGE.w * scale}px`;
    hit.style.height = `${spriteH}px`;
    rig.resize(pixelW, pixelH);
    fx.resize(pixelW, pixelH);
    keepInBounds();
  }

  const viewW = () => window.innerWidth, viewH = () => window.innerHeight;
  function keepInBounds() {
    if (docked) { x = docked === 'left' ? 0 : viewW(); y = clamp(y, spriteH * 0.3, Math.max(spriteH * 0.3, viewH() - spriteH * 0.3)); return; }
    const marginX = spriteW * 0.22, marginY = spriteH * 0.2;
    x = clamp(x, marginX, Math.max(marginX, viewW() - marginX));
    y = clamp(y, marginY, Math.max(marginY, viewH() - marginY));
  }

  // Her spot is kept as a fraction of the window: a hidden window measures zero when she
  // arrives, and a resize should carry her along rather than strand her.
  let anchor = null, docked = null;
  function placeInitial() {
    const p = settings.position;
    anchor = p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
    docked = p && (p.dock === 'left' || p.dock === 'right') ? p.dock : null;
    settle();
  }
  function settle() {
    if (viewW() < 8 || viewH() < 8) return;
    if (!anchor) anchor = { x: 1 - (spriteW * 0.7) / viewW(), y: 1 - (spriteH * 0.62) / viewH() };
    x = anchor.x * viewW();
    y = anchor.y * viewH();
    keepInBounds();
  }

  // ---- Bubble ---------------------------------------------------------------------------
  let lastKeyAt = -1e9, lastPointerAt = performance.now();
  let speech = null, speechQueue = [];
  function placeBubble() {
    const width = bubble.offsetWidth, height = bubble.offsetHeight;
    const headX = docked === 'left' ? x + spriteW * 0.26 : docked === 'right' ? x - spriteW * 0.26 : x, top = y - spriteH * 0.52;
    let left = clamp(headX - width / 2, 8, viewW() - width - 8), topPx = top - height - 4, side = 'above';
    if (topPx < 6) {
      const roomRight = viewW() - (x + spriteW * 0.5);
      if (roomRight > width + 12) { left = x + spriteW * 0.46; side = 'right'; } else { left = Math.max(8, x - spriteW * 0.46 - width); side = 'left'; }
      topPx = clamp(y - spriteH * 0.38, 6, viewH() - height - 6);
    }
    bubble.style.transform = `translate3d(${left}px, ${topPx}px, 0)`;
    bubble.dataset.side = side;
    bubble.style.setProperty('--tail-x', `${clamp(headX - left, 18, width - 18)}px`);
  }
  function startSpeech(item) {
    const cjk = /[㐀-鿿぀-ヿ]/.test(item.text);
    speech = { ...item, chars: Array.from(item.text), shown: 0, clock: 0, step: cjk ? 0.042 : 0.019, finished: 0, hold: item.ms || clamp(1900 + item.text.length * (cjk ? 110 : 48), 2900, 9500) };
    bubbleText.textContent = '';
    bubbleMark.textContent = item.ai ? '✦' : '';
    bubble.classList.add('show');
    placeBubble();
    const mood = HAGEMI.MOODS[item.mood];
    if (mood && !sulking && !dragging && !docked) animator.override(mood, speech.hold + 600);
    animator.setTalking(true);
  }
  function stepSpeech(dt, now) {
    if (!speech) {
      // Keep quiet while someone is typing, then speak.
      if (speechQueue.length && (now - lastKeyAt > 1400 || now - speechQueue[0].queuedAt > 12000)) startSpeech(speechQueue.shift());
      return;
    }
    if (speech.shown < speech.chars.length) {
      speech.clock += dt;
      while (speech.clock >= speech.step && speech.shown < speech.chars.length) {
        speech.clock -= speech.step;
        speech.shown++;
      }
      bubbleText.textContent = speech.chars.slice(0, speech.shown).join('');
      placeBubble();
      if (speech.shown >= speech.chars.length) { speech.finished = now; animator.setTalking(false); }
    } else if (!bubble.matches(':hover') && now - speech.finished > speech.hold) {
      closeBubble();
    }
  }
  function closeBubble() {
    speech = null;
    animator.setTalking(false);
    bubble.classList.remove('show');
  }
  listen(bubble, 'click', closeBubble);

  // ---- HUD and menu ---------------------------------------------------------------------
  function renderHud() {
    hud.replaceChildren();
    for (const row of hudRows) {
      const line = make('div', 'row', hud);
      make('span', 'label', line).textContent = row.label;
      if (row.level != null) {
        const meter = make('span', 'meter', line);
        const fill = make('span', 'fill', meter);
        fill.style.width = `${Math.round(row.level * 100)}%`;
        fill.dataset.tone = row.level < 0.1 ? 'bad' : row.level < 0.25 ? 'warn' : 'ok';
      }
      make('span', 'value', line).textContent = row.value;
    }
  }
  function placeHud() {
    const width = hud.offsetWidth, height = hud.offsetHeight;
    const left = clamp(x - width / 2, 8, viewW() - width - 8);
    const below = y + spriteH * 0.52 + 6;
    const top = below + height < viewH() ? below : clamp(y - spriteH * 0.52 - height - 6, 6, viewH() - height - 6);
    hud.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }
  let hoverTimer = 0;
  function showHud() { if (hudRows.length && !dragging) { renderHud(); hud.classList.add('show'); placeHud(); animator.setMood({ showStash: true }); } }
  function hideHud() { hud.classList.remove('show'); animator.setMood({ showStash: false }); }

  function openMenu(px, py) {
    // The status panel would open behind the menu once the hover delay ran out.
    clearTimeout(hoverTimer);
    hideHud();
    menu.replaceChildren();
    const item = (label, action, checked) => {
      const button = make('button', 'item', menu);
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.textContent = (checked ? '✓ ' : '') + label;
      button.addEventListener('click', () => { closeMenu(); action(); });
    };
    const divider = () => make('div', 'divider', menu);
    item(ui.talk || 'Say something', () => send({ type: 'talk' }));
    item(ui.pat || 'Pat her head', () => petted());
    divider();
    item(ui.language_en || 'English', () => patch({ language: 'en' }), settings.language === 'en');
    item(ui.language_zhs || '简体中文', () => patch({ language: 'zhs' }), settings.language === 'zhs');
    item(ui.language_auto || 'Follow app language', () => patch({ language: 'auto' }), settings.language === 'auto');
    divider();
    for (const [key, label] of [['s', ui.size_s || 'Small'], ['m', ui.size_m || 'Medium'], ['l', ui.size_l || 'Large']]) item(label, () => patch({ size: key }), settings.size === key);
    divider();
    item(ui.mute || 'Mute comments', () => patch({ muted: !settings.muted }), settings.muted);
    item(ui.ai || 'AI comments', () => patch({ ai: { enabled: !settings.ai?.enabled } }), settings.ai?.enabled);
    item(ui.settings || 'Settings…', () => openPanel());
    item(ui.hide || 'Hide for 1 hour', () => patch({ hiddenUntil: Date.now() + 3600000 }));
    menu.classList.add('show');
    const width = menu.offsetWidth, height = menu.offsetHeight;
    menu.style.transform = `translate3d(${clamp(px, 6, viewW() - width - 6)}px, ${clamp(py, 6, viewH() - height - 6)}px, 0)`;
  }
  function closeMenu() { menu.classList.remove('show'); }
  // A closed shadow root hides its insides from the window, so clicks are told apart in two places:
  // the window only sees clicks elsewhere in the app, and the root sees which of her parts was hit.
  listen(window, 'pointerdown', event => { if (!event.composedPath().includes(host)) { closeMenu(); closePanel(); } }, { capture: true });
  listen(root, 'pointerdown', event => {
    const path = event.composedPath();
    if (!path.includes(menu)) closeMenu();
    if (!path.includes(panel) && !path.includes(menu)) closePanel();
  }, { capture: true });

  // Settings live on the pet: the app offers plugins no way to open a pane on demand.
  let modelChoices = [], usage = null;
  function openPanel() {
    panel.replaceChildren();
    const s = settings, ai = settings.ai || {};
    const head = make('div', 'panel-head', panel);
    make('b', '', head).textContent = ui.settings_title || 'Hagemi settings';
    const close = make('button', 'panel-close', head);
    close.type = 'button';
    close.setAttribute('aria-label', ui.close || 'Close');
    close.textContent = '×';
    close.addEventListener('click', closePanel);
    const section = title => { make('div', 'panel-section', panel).textContent = title; };
    const field = (label, control) => {
      const row = make('label', 'field', panel);
      make('span', '', row).textContent = label;
      row.appendChild(control);
    };
    const select = (value, options, onChange) => {
      const control = document.createElement('select');
      for (const [key, text] of options) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = text;
        control.appendChild(option);
      }
      control.value = value;
      control.addEventListener('change', () => onChange(control.value));
      return control;
    };
    const check = (value, onChange) => {
      const control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = !!value;
      control.addEventListener('change', () => onChange(control.checked));
      return control;
    };
    const number = (value, min, max, onChange) => {
      const control = document.createElement('input');
      control.type = 'number';
      control.min = min;
      control.max = max;
      control.value = value;
      control.addEventListener('change', () => onChange(Number(control.value)));
      return control;
    };
    section(ui.section_pet || 'Pet');
    field(ui.language || 'Language', select(s.language, [['auto', ui.language_auto], ['en', ui.language_en], ['zhs', ui.language_zhs]], value => patch({ language: value })));
    field(ui.size || 'Size', select(s.size, [['xs', ui.size_xs], ['s', ui.size_s], ['m', ui.size_m], ['l', ui.size_l], ['xl', ui.size_xl]], value => patch({ size: value })));
    field(ui.animation || 'Animation', select(s.animation, [['smooth', ui.animation_smooth], ['balanced', ui.animation_balanced], ['saver', ui.animation_saver]], value => patch({ animation: value })));
    field(ui.chattiness || 'Chattiness', select(s.chattiness, [['quiet', ui.chattiness_quiet], ['normal', ui.chattiness_normal], ['chatty', ui.chattiness_chatty]], value => patch({ chattiness: value })));
    field(ui.followCursor || 'Watch the cursor', check(s.followCursor, value => patch({ followCursor: value })));
    field(ui.mute || 'Mute comments', check(s.muted, value => patch({ muted: value })));
    section(ui.section_ai || 'AI comments');
    field(ui.ai_enabled || 'Use AI', check(ai.enabled, value => patch({ ai: { enabled: value } })));
    const choices = [...new Set([ai.model, ...modelChoices])].filter(Boolean).map(label => [label, label]);
    field(ui.ai_model || 'Model', select(ai.model, choices, value => patch({ ai: { model: value } })));
    field(ui.ai_contextLevel || 'What she can see', select(ai.contextLevel, [['minimal', ui.context_minimal], ['titles', ui.context_titles], ['snippets', ui.context_snippets]], value => patch({ ai: { contextLevel: value } })));
    field(ui.ai_minIntervalMin || 'Minutes between', number(ai.minIntervalMin, 1, 1440, value => patch({ ai: { minIntervalMin: value } })));
    field(ui.ai_maxPerHour || 'Max per hour', number(ai.maxPerHour, 0, 60, value => patch({ ai: { maxPerHour: value } })));
    field(ui.ai_maxPerDay || 'Max per day', number(ai.maxPerDay, 0, 500, value => patch({ ai: { maxPerDay: value } })));
    field(ui.ai_dailyTokenBudget || 'Daily token budget', number(ai.dailyTokenBudget, 0, 500000, value => patch({ ai: { dailyTokenBudget: value } })));
    field(ui.ai_pauseBelowQuota || 'Stop below quota %', number(Math.round((ai.pauseBelowQuota ?? 0.15) * 100), 0, 100, value => patch({ ai: { pauseBelowQuota: value / 100 } })));
    field(ui.ai_onlyWhenFocused || 'Only when focused', check(ai.onlyWhenFocused, value => patch({ ai: { onlyWhenFocused: value } })));
    const persona = document.createElement('textarea');
    persona.rows = 2;
    persona.maxLength = 600;
    persona.value = ai.personaExtra || '';
    persona.addEventListener('change', () => patch({ ai: { personaExtra: persona.value } }));
    field(ui.ai_personaExtra || 'Extra persona notes', persona);
    if (usage) {
      section(ui.section_usage || 'Usage today');
      make('div', 'panel-note', panel).textContent = (ui.usage || '{calls} AI comments, about {tokens} tokens').replace('{calls}', usage.calls).replace('{tokens}', usage.tokens);
    }
    section(ui.section_licenses || 'Credits and licenses');
    for (const key of ['license_code', 'license_art', 'license_inspired', 'license_fan']) make('div', 'panel-note', panel).textContent = ui[key] || '';
    const links = make('div', 'panel-note', panel);
    for (const [key, href] of [['license_link_crosspet', 'https://github.com/lokicorvus/crosspet'], ['license_link_art', 'https://creativecommons.org/licenses/by-nc-sa/4.0/']]) {
      const link = make('a', 'panel-link', links);
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = ui[key] || href;
    }
    panel.classList.add('show');
    const width = panel.offsetWidth, height = panel.offsetHeight;
    const left = x + spriteW * 0.5 + width + 10 < viewW() ? x + spriteW * 0.5 : Math.max(8, x - spriteW * 0.5 - width);
    panel.style.transform = `translate3d(${clamp(left, 8, viewW() - width - 8)}px, ${clamp(y - height / 2, 8, Math.max(8, viewH() - height - 8))}px, 0)`;
    send({ type: 'panelOpened' });
  }
  function closePanel() { panel.classList.remove('show'); }
  // Typing in the form must not reach the app's keyboard shortcuts or composer.
  for (const type of ['keydown', 'keyup', 'keypress']) listen(panel, type, event => { event.stopPropagation(); if (event.key === 'Escape') closePanel(); });

  function patch(change) {
    settings = { ...settings, ...change, ai: { ...settings.ai, ...change.ai } };
    applyVisibility();
    applySize();
    send({ type: 'settings', patch: change });
  }
  function applyVisibility() {
    const hidden = settings.hidden || (settings.hiddenUntil && Date.now() < settings.hiddenUntil);
    stage.style.display = hidden ? 'none' : 'block';
    if (hidden) { closeBubble(); hideHud(); }
  }

  // ---- Touch: pokes, pats, shakes, a short temper -----------------------------------------
  let annoyance = 0, rub = 0, lastRub = { x: 0, y: 0, at: 0 }, pettedUntil = 0, sulking = false;
  const inHead = py => py < y - spriteH * 0.06;
  function petted() {
    const now = performance.now();
    if (sulking) {
      sulking = false;
      annoyance = 0;
      animator.clearOverride('sulk');
      animator.override('coaxed', 1700, () => animator.override('forgiven', 2200));
      send({ type: 'touch', kind: 'coax' });
      return;
    }
    if (now > pettedUntil) send({ type: 'touch', kind: 'pet' });
    pettedUntil = now + 2400;
    animator.override('petted', 2400);
    if (Math.random() < 0.5) fx.burst('hearts', STAGE.cx, 400, 3);
    annoyance = Math.max(0, annoyance - 1.5);
  }
  function poked(head) {
    if (head) { petted(); return; }
    if (sulking) { animator.play('recoil'); return; }
    annoyance += 1;
    if (annoyance >= 7) {
      sulking = true;
      animator.override('sulk', 14000, () => { sulking = false; annoyance = 0; });
      send({ type: 'touch', kind: 'sulk' });
    } else if (annoyance >= 5.5) {
      animator.override('redhot', 2400);
      fx.burst('steam', STAGE.cx, 400);
      send({ type: 'touch', kind: 'redhot' });
    } else if (annoyance >= 4) {
      animator.override('puffed', 2600);
      animator.play('squish');
      send({ type: 'touch', kind: 'puffed' });
    } else if (annoyance >= 2.5) {
      animator.override('annoyed', 2200);
      animator.play('shake');
      send({ type: 'touch', kind: 'annoyed' });
    } else {
      animator.override('surprised', 1100);
      animator.play('gasp');
      send({ type: 'touch', kind: 'poke' });
    }
  }

  // Click-through: the hit box only catches the pointer over painted pixels.
  function updateHitTest(event) {
    if (dragging) return;
    const originX = x - (STAGE.w / 2) * scale, originY = y - (STAGE.h / 2) * scale;
    const artX = (event.clientX - originX) / scale, artY = (event.clientY - originY) / scale;
    const over = rig.opaqueAt(current, artX, artY);
    const value = over ? 'auto' : 'none';
    if (hit.style.pointerEvents !== value) hit.style.pointerEvents = value;
  }

  let lastClickAt = 0, shakeFlips = 0, shakeSign = 0, shakeClock = 0;
  listen(hit, 'pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    hit.setPointerCapture(event.pointerId);
    clearTimeout(hoverTimer);
    dragging = { id: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - x, offsetY: event.clientY - y, moved: false, at: performance.now(), px: event.clientX, py: event.clientY };
    closeBubble();
    hideHud();
  });
  listen(hit, 'pointermove', event => {
    if (!dragging || event.pointerId !== dragging.id) return;
    if (!dragging.moved && Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY) > 4) {
      dragging.moved = true;
      if (docked) {
        // Pulled out of the wall: she pops back to full size under the cursor.
        dragging.offsetX = 0;
        dragging.offsetY = 0;
        docked = null;
      }
      animator.override('dragged', 1e9);
      send({ type: 'touch', kind: 'grab' });
    }
    dragging.px = event.clientX;
    dragging.py = event.clientY;
  });
  const endDrag = event => {
    if (!dragging || (event.pointerId !== undefined && event.pointerId !== dragging.id)) return;
    const now = performance.now(), wasDrag = dragging.moved, heldAt = dragging.at, startY = dragging.startY;
    dragging = null;
    if (wasDrag) {
      animator.clearOverride('dragged');
      if (shakeFlips >= 4) {
        animator.override('dizzy', 3200);
        send({ type: 'touch', kind: 'shaken' });
      } else if (x < spriteW * 0.2 || x > viewW() - spriteW * 0.2) {
        docked = x < spriteW * 0.2 ? 'left' : 'right';
        vx = vy = 0;
        keepInBounds();
        savePosition();
      } else if (Math.hypot(vx, vy) > 1100) {
        animator.override('surprised', 700);
      }
      shakeFlips = 0;
    } else if (now - heldAt < 400) {
      const isDouble = now - lastClickAt < 320;
      lastClickAt = now;
      if (isDouble) {
        animator.override('gift', 1200);
        send({ type: 'talk' });
      } else {
        poked(inHead(startY));
      }
    }
  };
  listen(hit, 'pointerup', endDrag);
  listen(hit, 'pointercancel', endDrag);
  listen(hit, 'contextmenu', event => { event.preventDefault(); openMenu(event.clientX, event.clientY); });
  listen(hit, 'pointerenter', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(showHud, 650); });
  listen(hit, 'pointerleave', () => { clearTimeout(hoverTimer); hideHud(); });
  listen(hit, 'pointermove', event => {
    // A slow back-and-forth over her head is a pat.
    if (dragging || !inHead(event.clientY)) return;
    const now = performance.now();
    if (now - lastRub.at > 420) { rub = 0; lastRub = { x: event.clientX, y: event.clientY, at: now }; }
    rub += Math.hypot(event.clientX - lastRub.x, event.clientY - lastRub.y);
    lastRub = { x: event.clientX, y: event.clientY, at: now };
    if (rub > 260) { rub = 120; petted(); }
  });

  let pointerX = 0, pointerY = 0;
  listen(window, 'pointermove', event => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    lastPointerAt = performance.now();
    updateHitTest(event);
  }, { passive: true, capture: true });
  // Only the time of the keystroke is ever used; the key itself is never read.
  listen(window, 'keydown', () => { lastKeyAt = performance.now(); }, { passive: true, capture: true });
  listen(window, 'resize', () => { applySize(); settle(); }, { passive: true });

  // Tell the sidecar when nobody is looking, so she does not spend tokens on an empty room.
  const presence = () => send({ type: 'presence', visible: !document.hidden, focused: document.hasFocus(), idleMs: Math.round(performance.now() - Math.max(lastPointerAt, lastKeyAt)), language: navigator.language });
  listen(document, 'visibilitychange', presence);
  listen(window, 'focus', presence);
  listen(window, 'blur', presence);
  const presenceTimer = setInterval(presence, 15000);

  // ---- Frame loop -----------------------------------------------------------------------
  let lastFrame = performance.now(), t = rand(0, 100), raf = 0;
  let saveTimer = 0, savedAt = { x: -1, y: -1 }, lastMessageAt = performance.now();

  function savePosition() {
    savedAt = { x, y };
    anchor = { x: x / viewW(), y: y / viewH() };
    settings.position = docked ? { ...anchor, dock: docked } : anchor;
    send({ type: 'settings', patch: { position: settings.position } });
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!host.isConnected) { dispose(); return; }
    if (document.hidden || stage.style.display === 'none') { lastFrame = now; return; }
    const lively = animator.busy || dragging || Math.hypot(vx, vy) > 3 || speech || fade < 1;
    const fpsCap = settings.animation === 'saver' ? 20 : settings.animation === 'smooth' || lively ? 60 : 30;
    if (now - lastFrame < 1000 / fpsCap - 2) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    t += dt;
    if (!anchor) settle();

    if (dragging && dragging.moved) {
      const goalX = dragging.px - dragging.offsetX, goalY = dragging.py - dragging.offsetY;
      const nextX = lerp(x, goalX, 1 - Math.exp(-dt * 24)), nextY = lerp(y, goalY, 1 - Math.exp(-dt * 24));
      vx = (nextX - x) / Math.max(dt, 0.001);
      vy = (nextY - y) / Math.max(dt, 0.001);
      x = nextX;
      y = nextY;
      shakeClock += dt;
      const sign = Math.sign(vx);
      if (Math.abs(vx) > 700 && sign && sign !== shakeSign) { shakeSign = sign; shakeFlips++; shakeClock = 0; }
      if (shakeClock > 0.6) shakeFlips = 0;
    } else if (!dragging && !docked) {
      // Thrown: no gravity here, just drag and soft walls.
      x += vx * dt;
      y += vy * dt;
      const friction = Math.exp(-dt * 2.6);
      vx *= friction;
      vy *= friction;
      const minX = spriteW * 0.22, maxX = viewW() - spriteW * 0.22, minY = spriteH * 0.2, maxY = viewH() - spriteH * 0.2;
      let bumped = 0;
      if (x < minX) { bumped = Math.abs(vx); x = minX; vx = Math.abs(vx) * 0.55; }
      if (x > maxX) { bumped = Math.abs(vx); x = maxX; vx = -Math.abs(vx) * 0.55; }
      if (y < minY) { bumped = Math.max(bumped, Math.abs(vy)); y = minY; vy = Math.abs(vy) * 0.55; }
      if (y > maxY) { bumped = Math.max(bumped, Math.abs(vy)); y = maxY; vy = -Math.abs(vy) * 0.55; }
      if (bumped > 420) {
        animator.play('squish');
        if (animator.state !== 'dizzy') animator.override('oops', 800);
        fx.burst('dust', STAGE.cx, 400, 6);
      }
      if (Math.abs(vx) < 2) vx = 0;
      if (Math.abs(vy) < 2) vy = 0;
    }
    stage.style.transform = `translate3d(${x - (STAGE.w / 2 + MARGIN) * scale}px, ${y - (STAGE.h / 2 + MARGIN) * scale}px, 0)`;

    // Persist where she was left, once she has settled.
    if (!dragging && !vx && !vy && (Math.abs(x - savedAt.x) > 1 || Math.abs(y - savedAt.y) > 1)) {
      saveTimer += dt;
      if (saveTimer > 0.6) { saveTimer = 0; savePosition(); }
    }

    // Docked at a window edge she watches from the wall, peeking out as the cursor nears.
    if (docked && !dragging) {
      // Only over the part of her that shows: about 290 art pixels out from the wall, 360 once she
      // leans out, so the cursor has to leave what it can see before she hides again.
      const peeking = animator.state === `dock${docked === 'left' ? 'Left' : 'Right'}Peek`;
      const reach = (peeking ? 380 : 310) * scale;
      const near = Math.abs(pointerX - x) < reach && Math.abs(pointerY - y) < spriteH * 0.5 && now - lastPointerAt < 2000;
      const dockState = `dock${docked === 'left' ? 'Left' : 'Right'}${near ? 'Peek' : ''}`;
      animator.override(dockState, 1200);
    }

    const frameData = animator.update(dt, t, { vx, vy });
    const { P } = frameData;
    usePose(frameData.poseName);

    // She watches the cursor when it is active, the keyboard while you type.
    if (settings.followCursor) {
      const fresh = now - lastPointerAt < 3500;
      if (fresh && !['sleeping', 'sulk', 'exhausted'].includes(frameData.activeName)) {
        const dx = (pointerX - x) / 420, dy = (pointerY - (y - spriteH * 0.2)) / 340;
        const weight = frameData.activeName === 'idle' ? 1 : 0.35;
        P.lookX = lerp(P.lookX, clamp(dx, -1, 1), weight);
        P.lookY = lerp(P.lookY, clamp(dy, -1, 1), weight);
        P.head += clamp(dx, -1, 1) * 0.04 * weight;
      }
    }
    if (now - lastKeyAt < 1600 && frameData.activeName === 'idle') P.lookY = lerp(P.lookY, 0.85, 0.75);

    // Wall-clock, not frame count: a slow frame must not stretch the overlap into a ghost.
    if (fade < 1) {
      fade = Math.min(1, (now - fadeStart) / FADE_MS);
      if (fade >= 1) previous = null;
    }
    rig.draw(current, previous, fade, P, t, frameData.blink, pixelRatio, scale);
    fx.draw(dt, t, scale * pixelRatio, MARGIN * scale * pixelRatio, { shiftX: P.shiftX, shiftY: P.shiftY, bob: P.bob, sleeping: frameData.sleeping });

    stepSpeech(dt, now);
    if (speech) placeBubble();
    if (hud.classList.contains('show')) placeHud();

    // Sidecar gone: say goodbye instead of haunting the window.
    if (!options.standalone && now - lastMessageAt > 90000 && !leaving) leave();
    if (leaving && now > leaving) dispose();
  }

  function leave() {
    if (leaving) return;
    leaving = performance.now() + 1250;
    closeBubble();
    hideHud();
    animator.override('bye', 1400);
    animator.play('leave');
  }

  function dispose() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    clearInterval(presenceTimer);
    clearTimeout(hoverTimer);
    abort.abort();
    rig.destroy();
    fx.clear();
    host.remove();
  }

  function receive(message) {
    lastMessageAt = performance.now();
    switch (message.t) {
      case 'hello':
        settings = { ...settings, ...message.settings };
        ui = message.ui || ui;
        applySize();
        placeInitial();
        applyVisibility();
        break;
      case 'settings':
        settings = { ...settings, ...message.settings };
        ui = message.ui || ui;
        applySize();
        applyVisibility();
        break;
      case 'art':
        receiveArt(message.name, message.data);
        break;
      case 'facts':
        if (!sulking) animator.setState(message.state);
        animator.setMood({ quota: message.quota || 'ok', late: !!message.late, stashLevel: message.stashLevel ?? null, stashLabel: message.stashLabel || '', subagents: message.subagents || 0 });
        hudRows = message.hud || [];
        if (hud.classList.contains('show')) { renderHud(); placeHud(); }
        break;
      case 'react':
        if (message.state && !sulking && !dragging && !docked) animator.override(message.state, message.ms || 2600);
        if (message.gesture) for (const name of [].concat(message.gesture)) animator.play(name);
        if (message.burst) for (const name of [].concat(message.burst)) fx.burst(name, STAGE.cx, 400);
        break;
      case 'say':
        if (settings.muted && !message.force) break;
        speechQueue.push({ text: message.text, mood: message.mood, ai: message.ai, ms: message.ms, queuedAt: performance.now() });
        if (speechQueue.length > 2) speechQueue.shift();
        break;
      case 'models':
        modelChoices = message.models || modelChoices;
        usage = message.usage || usage;
        break;
      case 'heartbeat':
        applyVisibility();
        break;
      case 'bye':
        leave();
        break;
      default:
        break;
    }
  }

  document.documentElement.appendChild(host);
  hit.style.pointerEvents = 'none';
  applySize();
  placeInitial();
  usePose('idle');
  preloadClones();
  raf = requestAnimationFrame(frame);
  presence();
  send({ type: 'ready' });
  return { receive, dispose, animator, get position() { return { x, y }; } };
};
