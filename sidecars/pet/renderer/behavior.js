// Decides which painted pose she wears and how it moves. Poses carry the expression and the
// story; parameters, gestures and springs keep the art breathing between them.
HAGEMI.REST = {
  rot: 0, squash: 0, bob: 0, shiftX: 0, shiftY: 0, lean: 0, head: 0, nod: 0, lookX: 0, lookY: 0,
  earL: 0, earR: 0, ahoge: 0, hairSwayL: 0, hairSwayR: 0, hairWave: 2.2, hairLift: 0.2,
  tailBase: 0, tailAmp: 0.1, tailFreq: 0.55, tailSpring: 0, kick: 0, skirt: 0, breath: 1, opacity: 1,
};

// `pose` is a name, or a list to rotate through every `swap` seconds.
HAGEMI.STATES = {
  idle: { pose: ['idle', 'idle-2', 'idle-3'], swap: 34, float: 0.45 },
  listening: { pose: 'listening', lookY: 0.4, tailAmp: 0.18, tailFreq: 0.95, earL: -0.06, earR: 0.06, float: 0.35 },
  thinking: { pose: 'thinking', tailAmp: 0.09, tailFreq: 0.4, float: 0.35, head: -0.015, sway: 0.012 },
  deepthink: { pose: 'thinking', tailAmp: 0.06, tailFreq: 0.3, float: 0.15, sway: 0.03, breath: 0.7 },
  reading: { pose: 'reading', tailAmp: 0.09, float: 0.25, nodRate: 0.32, nodSize: 1.8 },
  writing: { pose: 'writing', tailAmp: 0.18, tailFreq: 1, float: 0.2, nodRate: 1.4, nodSize: 1.5 },
  running: { pose: 'running', tailAmp: 0.26, tailFreq: 1.5, float: 0.2, bounce: 7, bounceRate: 3.2 },
  searching: { pose: 'searching', tailAmp: 0.18, tailFreq: 0.9, float: 0.3, sway: 0.03, lookSweep: 0.7 },
  drawing: { pose: 'drawing', tailAmp: 0.24, tailFreq: 1.2, float: 0.3, sway: 0.022 },
  delegating: { pose: 'delegating', tailAmp: 0.22, tailFreq: 1, float: 0.45 },
  compacting: { pose: 'compact', tailAmp: 0.08, float: 0, squeeze: 0.02 },
  asking: { pose: 'asking', tailAmp: 0.3, tailFreq: 1.5, float: 0.3, bounce: 5, bounceRate: 2.4, earL: -0.08, earR: 0.08 },
  busy: { pose: ['busy_left', 'busy_right'], swap: 3.6, tailAmp: 0.26, tailFreq: 1.4, float: 0.15 },
  swamped: { pose: ['swamped_left', 'swamped_right'], swap: 1.5, tailAmp: 0.44, tailFreq: 2.1, wobble: 0.04, float: 0.1 },
  tired: { pose: 'tired', hairLift: 0, tailAmp: 0.05, tailFreq: 0.28, float: 0.05, ahoge: 0.26, earL: 0.1, earR: -0.1, breath: 0.8 },
  exhausted: { pose: 'tired', rot: 0.2, hairLift: 0.5, hairWave: 1.2, tailBase: 0.2, tailAmp: 0.02, tailFreq: 0.16, float: 0.75, ahoge: 0.6, earL: 0.22, earR: -0.22, stash: true, breath: 0.5 },
  resetSoon: { pose: 'forgiven', tailAmp: 0.36, tailFreq: 1.5, float: 0.45, bounce: 4, bounceRate: 2.2, stash: true },
  sleeping: { pose: 'sleeping', float: 0.8, hairWave: 1.3, tailAmp: 0.04, tailFreq: 0.14, breath: 2.1, sleeping: true, rot: 0.03, noBlink: true },
  dragged: { pose: 'surprised', kick: 5, hairWave: 3, tailAmp: 0.22, tailFreq: 1.1, float: 0, noFidget: true },
  dizzy: { pose: 'dizzy', wobble: 0.12, float: 0.1, tailAmp: 0.2, tailFreq: 1 },
  petted: { pose: 'pat', tailAmp: 0.3, tailFreq: 0.6, float: 0.4, nodRate: 1.1, nodSize: 2.2, earL: 0.1, earR: -0.1 },
  coaxed: { pose: 'coaxed', tailAmp: 0.24, tailFreq: 0.7, float: 0.35 },
  annoyed: { pose: 'annoyed', tailAmp: 0.3, tailFreq: 1.9, float: 0.12 },
  puffed: { pose: 'puffed', tailAmp: 0.46, tailFreq: 2.4, float: 0.08, squeeze: 0.012 },
  redhot: { pose: 'redhot', tailAmp: 0.6, tailFreq: 3, float: 0.05, shake: 2.4 },
  sulk: { pose: 'sulk', tailAmp: 0.14, tailFreq: 0.66, float: 0.03, noFidget: true },
  forgiven: { pose: 'forgiven', tailAmp: 0.3, tailFreq: 0.9, float: 0.4 },
  happy: { pose: 'happy', tailAmp: 0.34, tailFreq: 1.3, float: 0.45 },
  proud: { pose: 'proud', tailAmp: 0.3, tailFreq: 1.1, float: 0.5 },
  oops: { pose: 'oops', tailAmp: 0.2, tailFreq: 1.4, float: 0.1 },
  surprised: { pose: 'surprised', tailAmp: 0.34, tailFreq: 1.6, float: 0.2 },
  hum: { pose: 'hum', tailAmp: 0.18, tailFreq: 0.6, float: 0.5, nodRate: 0.9, nodSize: 2.4, sway: 0.025 },
  float: { pose: 'float', float: 1, hairLift: 0.3, hairWave: 3.4, kick: 2.4, rot: -0.04, tailBase: -0.1, tailAmp: 0.14, tailFreq: 0.4 },
  stretch: { pose: 'stretch', tailAmp: 0.2, float: 0.3, squeeze: -0.03 },
  yawn: { pose: 'yawn', tailAmp: 0.06, tailFreq: 0.3, float: 0.2 },
  gift: { pose: 'update', tailAmp: 0.34, tailFreq: 1.4, float: 0.45, bounce: 8, bounceRate: 2.4 },
  bye: { pose: 'bye', tailAmp: 0.2, float: 0.3 },
  dockLeft: { pose: 'edge_left', float: 0, tailAmp: 0.06, tailFreq: 0.4, docked: true, hairWave: 1.2 },
  dockLeftPeek: { pose: 'edge_left_peek', float: 0, tailAmp: 0.14, tailFreq: 0.8, docked: true, hairWave: 1.4 },
  dockRight: { pose: 'edge_right', float: 0, tailAmp: 0.06, tailFreq: 0.4, docked: true, hairWave: 1.2 },
  dockRightPeek: { pose: 'edge_right_peek', float: 0, tailAmp: 0.14, tailFreq: 0.8, docked: true, hairWave: 1.4 },
};

for (const scene of ['greet_morning', 'greet_noon', 'greet_afternoon', 'greet_evening', 'greet_night', 'greet_dawn', 'fest_halloween', 'fest_christmas', 'fest_newyear', 'fest_spring', 'fest_lantern', 'fest_dragonboat', 'fest_midautumn', 'fest_national']) {
  HAGEMI.STATES[scene] = { pose: scene, tailAmp: 0.24, tailFreq: 1, float: 0.4 };
}

// Which painted face a remark calls for.
HAGEMI.MOODS = {
  happy: 'happy', smug: 'proud', proud: 'proud', love: 'petted', excited: 'gift', surprised: 'surprised',
  worried: 'oops', sad: 'tired', angry: 'puffed', sleepy: 'yawn', thinking: 'thinking', embarrassed: 'coaxed', wink: 'proud', shocked: 'oops',
};

const easeInOut = p => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const hump = p => Math.sin(Math.PI * p);
const GESTURES = {
  hop: { ms: 620, run(p, a) { a.bob -= 62 * hump(p); a.squash += p < 0.16 ? -0.09 * hump(p / 0.16) : p > 0.84 ? -0.07 * hump((1 - p) / 0.16) : 0.035; a.hairLift += 0.6 * hump(p); } },
  bounce: { ms: 1180, run(p, a) { const q = p * 2 % 1, big = p < 0.5 ? 1 : 0.62; a.bob -= 64 * big * hump(q); a.squash += q < 0.14 ? -0.08 * hump(q / 0.14) : q > 0.86 ? -0.06 * hump((1 - q) / 0.14) : 0.03; a.hairLift += 0.55 * hump(q); } },
  spin: { ms: 1100, noMotion: true, run(p, a) { a.rot += easeInOut(p) * Math.PI * 2; a.bob -= 92 * hump(p); a.hairLift += 1.1 * hump(p); a.squash += 0.04 * hump(p); } },
  shiver: { ms: 720, run(p, a, t) { a.shiftX += Math.sin(t * 74) * 3.6 * (1 - p); } },
  nod: { ms: 760, run(p, a) { a.nod += 9 * Math.sin(p * Math.PI * 4) * (1 - p * 0.4); } },
  shake: { ms: 800, run(p, a) { a.head += 0.1 * Math.sin(p * Math.PI * 6) * (1 - p); a.lookX += 0.8 * Math.sin(p * Math.PI * 6) * (1 - p); } },
  earFlick: { ms: 340, run(p, a) { a.earR += 0.3 * hump(p); } },
  earFlickL: { ms: 340, run(p, a) { a.earL -= 0.3 * hump(p); } },
  tailSwish: { ms: 1100, run(p, a) { const e = hump(p); a.tailAmp += 0.5 * e; a.tailFreq += 1 * e; } },
  lookAround: { ms: 2600, run(p, a) { const e = Math.min(1, Math.min(p, 1 - p) * 5); a.lookX += Math.sin(p * Math.PI * 3) * 0.95 * e; a.lookY -= 0.2 * e; a.head += Math.sin(p * Math.PI * 3) * 0.04 * e; } },
  gasp: { ms: 540, run(p, a) { const e = hump(p); a.squash += 0.07 * e; a.shiftY -= 22 * e; a.ahoge -= 0.22 * e; a.tailSpring -= 0.3 * e; } },
  recoil: { ms: 520, run(p, a) { const e = hump(p); a.shiftX -= 18 * e; a.lean -= 0.06 * e; a.head -= 0.08 * e; } },
  squish: { ms: 460, run(p, a) { a.squash -= 0.09 * hump(p); } },
  pop: { ms: 300, soft: true, run(p, a) { a.squash += 0.035 * Math.sin(p * Math.PI * 2) * (1 - p); } },
  drift: { ms: 5200, run(p, a) { const e = hump(p); a.shiftY -= 38 * e; a.hairLift += 0.85 * e; a.kick += 2.6 * e; a.rot += Math.sin(p * Math.PI * 2) * 0.07; a.tailBase -= 0.1 * e; } },
  flop: { ms: 900, run(p, a) { const e = hump(p); a.squash -= 0.07 * e; a.ahoge += 0.45 * e; a.head += 0.08 * e; } },
  talk: { ms: 340, soft: true, run(p, a) { a.nod += 2.2 * hump(p); a.squash += 0.008 * hump(p); } },
  leave: { ms: 1300, run(p, a) { a.opacity -= Math.max(0, p - 0.5) * 2; a.shiftY -= p * p * 70; a.hairLift += p; } },
};

HAGEMI.createAnimator = function createAnimator(fx) {
  const { lerp, rand, clamp } = HAGEMI.util;
  const P = { ...HAGEMI.REST }, target = { ...HAGEMI.REST };
  const zero = Object.fromEntries(Object.keys(HAGEMI.REST).map(key => [key, 0]));
  let state = 'idle', overrideState = null, overrideUntil = 0, overrideThen = null;
  let mood = { quota: 'ok', late: false, stashLevel: null, stashLabel: '', subagents: 0, showStash: false };
  let gestures = [];
  let poseIndex = 0, poseClock = 0, lastPoseState = null;
  // Accumulated, never computed as time * frequency: with that, easing the frequency after a state
  // change sweeps the phase at a rate proportional to her uptime, which reads as violent shaking.
  let tailPhase = 0;
  let blink = 0, blinkStage = 0, blinkClock = 0, nextBlink = rand(1.5, 4), doubleBlink = false;
  let nextFidget = rand(9, 18), reducedMotion = false, talking = false, talkClock = 0;
  const springs = { hairL: [0, 0], hairR: [0, 0], ahoge: [0, 0], tail: [0, 0], skirt: [0, 0] };
  const stepSpring = (s, goal, k, c, dt) => { s[1] += (goal - s[0]) * k * dt - s[1] * c * dt; s[0] += s[1] * dt; return s[0]; };

  function play(name) {
    const gesture = GESTURES[name];
    if (!gesture || (reducedMotion && gesture.noMotion)) return;
    gestures = gestures.filter(g => g.name !== name);
    gestures.push({ name, run: gesture.run, ms: gesture.ms, born: performance.now() });
    // Big movements jostle her. Talking and pose changes must not, or the tail twitches through them.
    if (gesture.soft) return;
    springs.tail[1] += rand(-0.6, 0.6);
    springs.ahoge[1] += rand(-1.6, 1.6);
  }

  function current() {
    if (overrideState && performance.now() < overrideUntil) return overrideState;
    if (overrideState) { overrideState = null; if (overrideThen) { const then = overrideThen; overrideThen = null; then(); } }
    return state;
  }

  // Little scenes she plays when nothing else is going on.
  const VIGNETTES = { hum: { ms: 5200, burst: 'notes' }, stretch: { ms: 2600, gesture: 'pop' }, yawn: { ms: 2600 }, float: { ms: 7200, burst: 'sparkles' } };
  function fidget() {
    const active = current(), S = HAGEMI.STATES[active] || {};
    nextFidget = active === 'idle' ? rand(13, 30) : rand(18, 40);
    if (S.noFidget || S.docked || active === 'sleeping' || active === 'exhausted') return;
    if (active !== 'idle') {
      play(['earFlick', 'earFlickL', 'tailSwish'][(Math.random() * 3) | 0]);
      return;
    }
    const pool = mood.quota === 'ok' && !mood.late
      ? ['lookAround', 'earFlick', 'tailSwish', 'drift', 'hop', 'lookAround', 'hum', 'float', 'stretch']
      : ['earFlick', 'stretch', 'yawn', 'yawn', 'lookAround', 'flop'];
    const pick = pool[(Math.random() * pool.length) | 0];
    const scene = VIGNETTES[pick];
    if (scene) {
      overrideState = pick;
      overrideUntil = performance.now() + scene.ms;
      if (scene.burst) fx.burst(scene.burst, HAGEMI.STAGE.cx, 400, 6);
      if (scene.gesture) play(scene.gesture);
      nextFidget = rand(20, 40);
    } else {
      play(pick);
      if (pick === 'drift') fx.burst('sparkles', HAGEMI.STAGE.cx, 400, 6);
    }
  }

  function update(dt, t, motion) {
    const activeName = current();
    const S = HAGEMI.STATES[activeName] || HAGEMI.STATES.idle;
    const now = performance.now();

    // Which painted pose.
    if (lastPoseState !== activeName) { lastPoseState = activeName; poseClock = 0; }
    const poses = Array.isArray(S.pose) ? S.pose : [S.pose];
    if (poses.length > 1) {
      poseClock += dt;
      if (poseClock >= (S.swap || 30)) { poseClock = 0; poseIndex++; }
    }
    const poseName = poses[poseIndex % poses.length];

    // Sustained motion.
    Object.assign(target, HAGEMI.REST);
    for (const key of Object.keys(target)) if (S[key] !== undefined) target[key] = S[key];
    const float = S.float ?? 0.3;
    target.shiftY = -float * 8;
    target.hairLift = S.hairLift ?? 0.08 + float * 0.4;
    target.hairWave = S.hairWave ?? 1.5 + float * 1.2;
    target.kick = S.kick ?? float * 1.2;
    target.bob = reducedMotion ? 0 : Math.sin(t * 1.5) * (1.5 + float * 8);
    if (S.bounce && !reducedMotion) target.bob -= Math.abs(Math.sin(t * S.bounceRate * Math.PI)) * S.bounce;
    target.breath = (S.breath ?? 1) * (Math.sin(t * 2) * 0.5 + 0.5) * 2.2;
    if (S.squeeze) target.squash = S.squeeze * (Math.sin(t * 3.4) * 0.5 + 0.5);
    if (S.sway) target.head += Math.sin(t * 1.3) * S.sway;
    if (S.nodRate) target.nod = Math.sin(t * S.nodRate * 6.283) * S.nodSize;
    if (S.lookSweep) target.lookX = Math.sin(t * 2) * S.lookSweep;
    if (S.wobble) { target.rot += Math.sin(t * 5.5) * S.wobble; target.head += Math.sin(t * 7) * S.wobble * 0.6; }
    if (S.shake) target.shiftX = Math.sin(t * 64) * S.shake;

    // Being low on dried fish sags whatever she is doing, more so at rest.
    const resting = activeName === 'idle';
    const sag = mood.quota === 'critical' ? 1 : mood.quota === 'low' ? 0.5 : 0;
    if (sag && activeName !== 'exhausted' && !S.docked) {
      const weight = sag * (resting ? 1 : 0.5);
      target.ahoge += 0.28 * weight;
      target.earL += 0.1 * weight;
      target.earR -= 0.1 * weight;
      target.hairLift *= 1 - 0.8 * weight;
      target.tailAmp *= 1 - 0.55 * weight;
      target.tailFreq *= 1 - 0.3 * weight;
      target.shiftY *= 1 - 0.8 * weight;
    }

    const add = { ...zero };
    gestures = gestures.filter(g => {
      const p = (now - g.born) / g.ms;
      if (p >= 1) return false;
      g.run(p, add, t);
      return true;
    });

    const rate = 1 - Math.exp(-dt * (activeName === 'dragged' ? 16 : 6));
    for (const key of Object.keys(P)) P[key] = lerp(P[key], target[key], rate);

    // Follow-through: hair and tail trail the body, the ahoge rings.
    const vx = clamp(motion.vx, -2600, 2600), vy = clamp(motion.vy, -2600, 2600);
    const hairL = stepSpring(springs.hairL, -vx * 0.017, 60, 7, dt);
    const hairR = stepSpring(springs.hairR, -vx * 0.02, 52, 6, dt);
    const ahoge = stepSpring(springs.ahoge, -vx * 0.00032 + vy * 0.0002, 120, 8, dt);
    const tail = stepSpring(springs.tail, vx * 0.00048 + vy * 0.00016, 30, 7.5, dt);
    const skirt = stepSpring(springs.skirt, -vx * 0.006, 80, 7, dt);

    const output = {};
    for (const key of Object.keys(P)) output[key] = P[key] + add[key];
    output.hairSwayL = hairL;
    output.hairSwayR = hairR;
    output.ahoge += ahoge + Math.sin(t * 2.3) * 0.016;
    output.tailSpring += tail;
    tailPhase = (tailPhase + dt * Math.max(0, output.tailFreq) * 6.283) % 6.283;
    output.tailPhase = tailPhase;
    output.skirt = skirt + Math.sin(t * 1.15) * 0.9;
    output.lean = clamp(output.lean + vx * 0.00002, -0.28, 0.28);
    output.rot += clamp(vx * 0.00004, -0.34, 0.34);
    output.opacity = clamp(1 + add.opacity, 0, 1);

    if (talking) {
      talkClock -= dt;
      if (talkClock <= 0) { play('talk'); talkClock = rand(0.34, 0.6); }
    }

    // Blinks: down fast, up slower, sometimes twice.
    nextBlink -= dt;
    if (blinkStage === 0 && nextBlink <= 0 && !S.noBlink) { blinkStage = 1; blinkClock = 0; doubleBlink = Math.random() < 0.16; nextBlink = rand(2.2, 6.2); }
    if (blinkStage === 1) {
      blinkClock += dt;
      blink = clamp(blinkClock / 0.06, 0, 1);
      if (blinkClock >= 0.1) { blinkStage = 2; blinkClock = 0; }
    } else if (blinkStage === 2) {
      blinkClock += dt;
      blink = 1 - clamp(blinkClock / 0.1, 0, 1);
      if (blinkClock >= 0.1) {
        if (doubleBlink) { doubleBlink = false; blinkStage = 1; blinkClock = 0; } else blinkStage = 0;
      }
    } else blink = 0;

    if (!reducedMotion) {
      nextFidget -= dt;
      if (nextFidget <= 0) fidget();
    }

    const showStash = (S.stash || mood.showStash || mood.quota === 'low' || mood.quota === 'critical') && !S.docked;
    fx.setStash(showStash && mood.stashLevel != null ? { level: mood.stashLevel, label: mood.stashLabel } : null);
    fx.setClones(activeName === 'exhausted' || activeName === 'sleeping' || S.docked ? 0 : mood.subagents);

    return { P: output, poseName, activeName, blink, sleeping: !!S.sleeping };
  }

  return {
    update,
    play,
    setState(name) { if (HAGEMI.STATES[name]) state = name; },
    override(name, ms, then) {
      if (HAGEMI.STATES[name]) { overrideState = name; overrideUntil = performance.now() + ms; overrideThen = then || null; }
    },
    clearOverride(name) { if (!name || overrideState === name) { overrideState = null; overrideThen = null; } },
    setMood(next) { mood = { ...mood, ...next }; },
    setReducedMotion(value) { reducedMotion = value; },
    setTalking(value) { talking = value; talkClock = 0; },
    get state() { return current(); },
    get busy() { return gestures.length > 0 || current() === 'dragged'; },
  };
};
