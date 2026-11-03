// Pure decisions: which state the facts call for, how each event is acted out, and what time of
// day or year it is for her. No I/O here, so all of it is covered by tests.
const HOUR = 3600000, MINUTE = 60000;

const CATEGORY_STATE = { reading: 'reading', writing: 'writing', running: 'running', searching: 'searching', drawing: 'drawing', delegating: 'delegating', compacting: 'compacting', asking: 'asking' };

export function chooseState(facts, quota, { resetSoon = false, sleepAfterMs = 10 * MINUTE, deepThinkMs = 30000 } = {}) {
  if (quota?.mood === 'empty') return 'exhausted';
  if (facts.waiting) return 'asking';
  if (facts.running >= 3) return 'swamped';
  if (facts.running === 2) return 'busy';
  if (facts.category && CATEGORY_STATE[facts.category]) return CATEGORY_STATE[facts.category];
  if (facts.subagents > 0) return 'delegating';
  if (facts.running >= 1) return facts.quietMs > deepThinkMs ? 'deepthink' : 'thinking';
  if (resetSoon) return 'resetSoon';
  if (quota?.mood === 'critical') return 'tired';
  if (facts.idleMs > sleepAfterMs) return 'sleeping';
  return 'idle';
}

// How she acts each moment out. salience: 0-1, how much it deserves a remark.
// ai: worth spending tokens on. urgent: skips the bubble rate limit. cooldownMin: per trigger.
export const REACTIONS = {
  turn_start: { salience: 0.12, cooldownMin: 4, react: { state: 'listening', ms: 1500, gesture: 'gasp' } },
  turn_done: { salience: 0.32, cooldownMin: 3, react: { state: 'happy', ms: 2600, gesture: 'hop', burst: 'sparkles' } },
  turn_done_big: { salience: 0.72, cooldownMin: 2, ai: true, react: { state: 'proud', ms: 3800, gesture: 'spin', burst: 'confetti' } },
  turn_error: { salience: 0.78, cooldownMin: 2, ai: true, react: { state: 'oops', ms: 3600, gesture: 'shiver', burst: 'sweat' } },
  turn_canceled: { salience: 0.3, cooldownMin: 5, react: { state: 'oops', ms: 1800, gesture: 'recoil' } },
  turn_maxed: { salience: 0.55, cooldownMin: 10, react: { state: 'oops', ms: 2600, gesture: 'flop' } },
  step_error: { salience: 0.2, cooldownMin: 6, react: { state: 'oops', ms: 1200, gesture: 'shiver' } },
  long_run: { salience: 0.5, cooldownMin: 25, ai: true, react: { gesture: 'lookAround' } },
  waiting: { salience: 0.62, cooldownMin: 3, urgent: true, react: { gesture: 'hop' } },
  subagent_start: { salience: 0.42, cooldownMin: 8, react: { state: 'delegating', ms: 2400, gesture: 'hop', burst: 'sparkles' } },
  subagent_many: { salience: 0.62, cooldownMin: 12, ai: true, react: { state: 'proud', ms: 2600, gesture: 'bounce', burst: 'sparkles' } },
  subagent_done: { salience: 0.25, cooldownMin: 8, react: { gesture: 'nod' } },
  busy: { salience: 0.32, cooldownMin: 20, react: { gesture: 'earFlick' } },
  swamped: { salience: 0.6, cooldownMin: 15, ai: true, react: { gesture: 'shiver', burst: 'sweat' } },
  context_big: { salience: 0.5, cooldownMin: 45, ai: true, react: { state: 'oops', ms: 2000, gesture: 'flop' } },
  compact: { salience: 0.25, cooldownMin: 15, react: { gesture: 'squish' } },
  drawing: { salience: 0.45, cooldownMin: 15, react: { gesture: 'tailSwish', burst: 'sparkles' } },
  model_rival_claude: { salience: 0.55, cooldownMin: 180, ai: true, react: { state: 'puffed', ms: 3000, gesture: 'shake' } },
  model_rival_gpt: { salience: 0.55, cooldownMin: 180, ai: true, react: { state: 'puffed', ms: 3000, gesture: 'shake' } },
  model_back: { salience: 0.5, cooldownMin: 60, react: { state: 'happy', ms: 2600, gesture: 'bounce', burst: 'hearts' } },
  quota_low: { salience: 0.62, cooldownMin: 90, urgent: true, react: { state: 'tired', ms: 2800, gesture: 'flop' } },
  quota_critical: { salience: 0.8, cooldownMin: 45, urgent: true, ai: true, react: { state: 'tired', ms: 3400, gesture: 'flop' } },
  quota_empty: { salience: 0.92, cooldownMin: 30, urgent: true, react: { state: 'exhausted', ms: 4000, gesture: 'flop' } },
  reset_soon: { salience: 0.6, cooldownMin: 60, ai: true, react: { state: 'resetSoon', ms: 3000, gesture: 'hop' } },
  quota_refilled: { salience: 0.72, cooldownMin: 30, urgent: true, react: { state: 'gift', ms: 4200, gesture: 'bounce', burst: ['honey', 'confetti'] } },
  late_night: { salience: 0.5, cooldownMin: 240, ai: true, react: { state: 'yawn', ms: 2600 } },
  long_session: { salience: 0.46, cooldownMin: 120, ai: true, react: { state: 'stretch', ms: 2800 } },
  friday: { salience: 0.46, cooldownMin: 1440, react: { gesture: 'hop' } },
  wake: { salience: 0.2, cooldownMin: 20, react: { state: 'yawn', ms: 2400 } },
  idle_ponder: { salience: 0.36, cooldownMin: 40, ai: true, react: { gesture: 'lookAround' } },
  greet: { salience: 1, cooldownMin: 0, urgent: true, react: { gesture: 'hop', burst: 'sparkles' } },
  poke: { salience: 0.9, cooldownMin: 0.05, urgent: true },
  annoyed: { salience: 0.9, cooldownMin: 0.1, urgent: true },
  puffed: { salience: 0.9, cooldownMin: 0.1, urgent: true },
  redhot: { salience: 0.9, cooldownMin: 0.1, urgent: true },
  sulk: { salience: 0.9, cooldownMin: 0.2, urgent: true },
  coax: { salience: 0.9, cooldownMin: 0.1, urgent: true },
  pet: { salience: 0.75, cooldownMin: 0.3, urgent: true },
  shaken: { salience: 0.9, cooldownMin: 0.2, urgent: true },
  grab: { salience: 0.5, cooldownMin: 1, urgent: true },
};

export const CHATTINESS = {
  quiet: { gapSec: 300, floor: 0.6, aiFloor: 0.7 },
  normal: { gapSec: 90, floor: 0.3, aiFloor: 0.5 },
  chatty: { gapSec: 40, floor: 0.12, aiFloor: 0.36 },
};

// Turns a finished turn into the moment it deserves.
export function classifyTurnEnd(event) {
  const reason = event.termination || '';
  if (reason === 'ERROR' || reason.includes('ERROR')) return 'turn_error';
  if (reason.includes('MAX_')) return 'turn_maxed';
  if (reason.includes('CANCEL') || reason === 'HALTED') return 'turn_canceled';
  const big = (event.toolCount || 0) >= 8 || (event.durationMs || 0) >= 5 * MINUTE;
  if ((event.errors || 0) >= 3 && !big) return 'turn_error';
  return big ? 'turn_done_big' : 'turn_done';
}

export function timeOfDay(date) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'noon';
  if (hour >= 14 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  if (hour >= 2 && hour < 5) return 'dawn';
  return 'night';
}

const LUNAR = {
  fest_spring: ['2027-02-06', '2028-01-26', '2029-02-13', '2030-02-03'],
  fest_lantern: ['2027-02-20', '2028-02-09', '2029-02-27', '2030-02-17'],
  fest_dragonboat: ['2027-06-09', '2028-05-28', '2029-06-16', '2030-06-05'],
  fest_midautumn: ['2027-09-15', '2028-10-03', '2029-09-22', '2030-09-12'],
};
export function festival(date) {
  const month = date.getMonth() + 1, day = date.getDate();
  const pad = n => String(n).padStart(2, '0');
  const iso = `${date.getFullYear()}-${pad(month)}-${pad(day)}`;
  if (month === 10 && day === 31) return 'fest_halloween';
  if (month === 12 && (day === 24 || day === 25)) return 'fest_christmas';
  if (month === 1 && day === 1) return 'fest_newyear';
  if (month === 10 && day === 1) return 'fest_national';
  for (const [name, dates] of Object.entries(LUNAR)) if (dates.includes(iso)) return name;
  return null;
}

export const isLate = date => date.getHours() >= 1 && date.getHours() < 5;

export function modelFamily(label = '') {
  const lower = label.toLowerCase();
  if (/claude|anthropic/.test(lower)) return 'claude';
  if (/gpt|openai/.test(lower)) return 'gpt';
  if (/gemini/.test(lower)) return 'gemini';
  return 'other';
}

// Time-based nudges: returns triggers that have newly become true.
export function ambientTriggers({ now, activeSinceMs, active, lastRemarkAgoMs, idleMs }) {
  const date = new Date(now), triggers = [];
  if (active && isLate(date)) triggers.push('late_night');
  if (active && activeSinceMs >= 2 * HOUR) triggers.push('long_session');
  if (active && date.getDay() === 5 && date.getHours() >= 17) triggers.push('friday');
  if (lastRemarkAgoMs >= 35 * MINUTE && idleMs < 10 * MINUTE) triggers.push('idle_ponder');
  return triggers;
}
