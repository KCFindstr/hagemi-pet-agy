// Watches Antigravity conversations and turns their changes into events.
// Polls cheaply: the session list, plus new bytes of the transcripts that are actually running.
// Hooks would be the documented route, but they spawn a process per tool call inside the agent
// loop. Reading from the side costs the agent nothing, so she can never slow it down.
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';

const TOOL_CATEGORY = new Map(Object.entries({
  read_file: 'reading', view_file: 'reading', view_file_outline: 'reading', view_code_item: 'reading', view_content_chunk: 'reading',
  list_dir: 'reading', list_directory: 'reading', find_by_name: 'reading', grep_search: 'reading', code_search: 'reading', find_all_references: 'reading',
  write_file: 'writing', write_to_file: 'writing', edit_file: 'writing', replace_file_content: 'writing', multi_replace_file_content: 'writing', edit_notebook: 'writing',
  run_command: 'running', command_status: 'running', send_command_input: 'running', read_terminal: 'running', execute_notebook: 'running',
  search_web: 'searching', read_url_content: 'searching', open_browser_url: 'searching', read_browser_page: 'searching', browser_subagent: 'searching', search_marketplace: 'searching',
  generate_image: 'drawing',
  invoke_subagent: 'delegating', define_subagent: 'delegating', manage_subagents: 'delegating', send_message: 'delegating',
  ask_question: 'asking', ask_permission: 'asking',
}));
const QUIET_TOOLS = new Set(['manage_task', 'schedule', 'list_permissions', 'task_boundary', 'notify_user', 'finish', 'wait', 'checkpoint']);

export function toolCategory(name) {
  if (!name || QUIET_TOOLS.has(name)) return null;
  const known = TOOL_CATEGORY.get(name);
  if (known) return known;
  if (/image|draw|paint/.test(name)) return 'drawing';
  if (/subagent|delegate/.test(name)) return 'delegating';
  if (/browser|web|url|fetch/.test(name)) return 'searching';
  if (/write|edit|replace|patch|create/.test(name)) return 'writing';
  if (/read|view|list|grep|find|search|glob/.test(name)) return 'reading';
  return 'running';
}

const statusOf = raw => (/RUNNING|BUSY|CANCELING/.test(raw || '') ? 'running' : 'idle');
const millis = value => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

export function parseConversations(response) {
  const conversations = new Map();
  for (const [id, value] of Object.entries(response?.trajectorySummaries || {})) {
    const metadata = value.trajectoryMetadata || {};
    conversations.set(id, {
      id,
      title: value.annotations?.title || value.summary || '',
      status: statusOf(value.status),
      steps: Number(value.stepCount) || 0,
      modifiedAt: millis(value.lastModifiedTime),
      userInputAt: millis(value.lastUserInputTime),
      parentId: metadata.parentConversationId || null,
      termination: (value.latestExecutorTerminationReason || '').replace('EXECUTOR_TERMINATION_REASON_', ''),
      // Steps paused on the user: a question or a permission prompt.
      waiting: Array.isArray(value.waitingSteps) && value.waitingSteps.length > 0,
    });
  }
  return conversations;
}

// Pure: what changed between two polls.
export function diffConversations(previous, next, now) {
  const events = [];
  if (!previous) return events;
  for (const [id, current] of next) {
    const before = previous.get(id);
    const wasRunning = before?.status === 'running', isRunning = current.status === 'running';
    if (current.parentId) {
      if (!wasRunning && isRunning) events.push({ type: 'subagent_start', id, parentId: current.parentId });
      if (wasRunning && !isRunning) events.push({ type: 'subagent_done', id, parentId: current.parentId, termination: current.termination });
      continue;
    }
    if (!wasRunning && isRunning) events.push({ type: 'turn_start', id, title: current.title, fresh: !before });
    if (wasRunning && !isRunning) events.push({ type: 'turn_end', id, title: current.title, termination: current.termination, steps: current.steps - (before?.steps || 0) });
    if (before && current.userInputAt > before.userInputAt && now - current.userInputAt < 60000) events.push({ type: 'user_input', id, title: current.title });
  }
  return events;
}

const TAIL_WINDOW = 48 * 1024;
const REQUEST = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/;

export class TranscriptTail {
  // since: on the first read, steps older than this are context and report nothing.
  constructor(file, since = Infinity) {
    this.file = file;
    this.since = since;
    this.offset = null;
    this.remainder = '';
    this.lastTool = null;
    this.toolCount = 0;
    this.errors = 0;
    this.inputTokens = 0;
    this.lastUserText = '';
    this.lastAgentText = '';
    this.compacting = false;
    this.lastStepAt = 0;
    this.lastStepRunning = false;
  }

  // Returns events found since the last read.
  async read() {
    let info;
    try { info = await stat(this.file); } catch { return []; }
    const first = this.offset === null;
    if (first) this.offset = Math.max(0, info.size - TAIL_WINDOW);
    if (info.size < this.offset) { this.offset = 0; this.remainder = ''; }
    if (info.size === this.offset) return [];
    const startedMidFile = first && this.offset > 0;
    const length = Math.min(info.size - this.offset, 1 << 20);
    const handle = await open(this.file, 'r');
    let text = '';
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, this.offset);
      this.offset += length;
      text = this.remainder + buffer.toString('utf8');
    } finally { await handle.close(); }
    const lines = text.split('\n');
    this.remainder = lines.pop() || '';
    if (startedMidFile && lines.length) lines.shift();
    const events = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      let step;
      try { step = JSON.parse(line); } catch { continue; }
      const stepAt = Date.parse(step.created_at || '') || 0;
      for (const event of this.ingest(step)) if (!first || stepAt >= this.since) events.push(event);
    }
    return events;
  }

  ingest(step) {
    const events = [];
    this.lastStepAt = Date.parse(step.created_at || '') || Date.now();
    this.lastStepRunning = step.status === 'RUNNING';
    if (step.type === 'USER_INPUT') {
      const match = String(step.content || '').match(REQUEST);
      if (match) this.lastUserText = match[1];
      this.toolCount = 0;
      this.errors = 0;
    } else if (step.type === 'GENERIC' && step.source === 'MODEL' && step.content) {
      this.lastAgentText = String(step.content);
    } else if (step.type === 'CHECKPOINT') {
      events.push({ type: 'compact' });
    } else if (step.type === 'PLANNER_RESPONSE') {
      if (step.input_tokens) this.inputTokens = Number(step.input_tokens) || this.inputTokens;
      for (const call of step.tool_calls || []) {
        const category = toolCategory(call.name);
        if (category) {
          this.lastTool = call.name;
          this.toolCount++;
          events.push({ type: 'tool', name: call.name, category });
        }
      }
    }
    if (step.status === 'ERROR' || step.type === 'ERROR_MESSAGE') {
      this.errors++;
      events.push({ type: 'step_error' });
    }
    return events;
  }
}

export class Monitor {
  constructor({ ls, brainDir, onEvent, onFacts, now = Date.now, tailFactory = (file, since) => new TranscriptTail(file, since) }) {
    Object.assign(this, { ls, brainDir, onEvent, onFacts, now, tailFactory });
    this.conversations = null;
    this.tails = new Map();
    this.starts = new Map();
    this.category = null;
    this.categoryAt = 0;
    this.lastActivityAt = now();
    this.timer = null;
    this.healthy = false;
    this.bigContextWarned = new Set();
  }

  tailFor(id, since) {
    let tail = this.tails.get(id);
    if (!tail) {
      tail = this.tailFactory(join(this.brainDir, id, '.system_generated', 'logs', 'transcript.jsonl'), since);
      this.tails.set(id, tail);
    }
    return tail;
  }

  async poll() {
    const response = await this.ls.call('GetAllCascadeTrajectories', { excludeSubtrajectories: false });
    const next = parseConversations(response);
    const now = this.now();
    const events = diffConversations(this.conversations, next, now);
    const firstPoll = !this.conversations;
    this.conversations = next;

    for (const event of events) {
      if (event.type === 'turn_start') this.starts.set(event.id, now);
      if (event.type === 'turn_end') {
        const started = this.starts.get(event.id);
        event.durationMs = started ? now - started : 0;
        const tail = this.tails.get(event.id);
        if (tail) {
          // Catch the last steps before reporting on the turn.
          for (const late of await tail.read()) this.onEvent({ ...late, id: event.id });
          event.toolCount = tail.toolCount;
          event.errors = tail.errors;
          event.agentText = tail.lastAgentText;
          event.userText = tail.lastUserText;
        }
        this.starts.delete(event.id);
      }
      this.lastActivityAt = now;
    }

    const running = [...next.values()].filter(c => c.status === 'running');
    if (firstPoll) for (const c of running) if (!c.parentId) this.starts.set(c.id, now);
    // Already running when she arrived: history. Started since the last poll: report it all,
    // with some slack because transcript timestamps only have one-second resolution.
    const since = firstPoll ? Infinity : now - 15000;
    for (const conversation of running) {
      const tail = this.tailFor(conversation.id, since);
      for (const event of await tail.read()) {
        this.onEvent({ ...event, id: conversation.id, title: conversation.title, isSubagent: !!conversation.parentId });
        if (event.type === 'tool') {
          if (!conversation.parentId || !this.category) { this.category = event.category; this.categoryAt = now; }
          this.lastActivityAt = now;
        }
        if (event.type === 'compact') { this.category = 'compacting'; this.categoryAt = now; }
      }
      if (!conversation.parentId && tail.inputTokens >= 400000 && !this.bigContextWarned.has(conversation.id)) {
        this.bigContextWarned.add(conversation.id);
        this.onEvent({ type: 'context_big', id: conversation.id, title: conversation.title, tokens: tail.inputTokens });
      }
    }
    // Forget tails of finished conversations so a long session does not accumulate them.
    for (const id of this.tails.keys()) if (next.get(id)?.status !== 'running' && !events.some(e => e.id === id)) this.tails.delete(id);

    for (const event of events) this.onEvent(event);
    this.onFacts?.(this.facts(next, now));
    this.healthy = true;
    return running.length;
  }

  facts(conversations = this.conversations, now = this.now()) {
    const all = conversations ? [...conversations.values()] : [];
    const roots = all.filter(c => c.status === 'running' && !c.parentId);
    const subagents = all.filter(c => c.status === 'running' && c.parentId);
    if (!roots.length && !subagents.length) this.category = null;
    const primary = roots.slice().sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
    const tail = primary && this.tails.get(primary.id);
    const longestRun = roots.reduce((longest, c) => Math.max(longest, now - (this.starts.get(c.id) || now)), 0);
    // Quiet tail while a turn is live: the model is thinking rather than using a tool.
    const stale = now - this.categoryAt > 12000;
    return {
      waiting: all.some(c => c.status === 'running' && c.waiting),
      running: roots.length,
      subagents: subagents.length,
      title: primary?.title || '',
      category: stale && this.category !== 'delegating' ? null : this.category,
      lastTool: tail?.lastTool || null,
      toolCount: tail?.toolCount || 0,
      inputTokens: tail?.inputTokens || 0,
      longestRunMs: longestRun,
      idleMs: roots.length || subagents.length ? 0 : now - this.lastActivityAt,
      userText: tail?.lastUserText || '',
      agentText: tail?.lastAgentText || '',
      connected: this.healthy,
    };
  }

  start(intervalRunning = 2000, intervalIdle = 4000) {
    const tick = async () => {
      let running = 0;
      try { running = await this.poll(); } catch (error) {
        this.healthy = false;
        this.onError?.(error);
      }
      if (this.stopped) return;
      this.timer = setTimeout(tick, running ? intervalRunning : intervalIdle);
      this.timer.unref?.();
    };
    tick();
  }

  stop() { this.stopped = true; clearTimeout(this.timer); }
}
