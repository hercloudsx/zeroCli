import { Engine, AbortError } from '../agent/engine.js';
import { createProvider } from '../providers/index.js';
import { getTool } from '../tools/index.js';
import { ReadTool } from '../tools/read.js';
import { GlobTool, GrepTool, LSTool } from '../tools/search.js';
import { TodoWriteTool } from '../tools/misc.js';
import { ORCH_TOOLS } from './tools.js';
import { CATALOG, FAMILIES, getModel, fmtContext, UNRELIABLE_UPTIME } from './catalog.js';
import { orchConfig, profileForModel, enabledModels, routeFor } from './config.js';
import { settings } from '../utils/settings.js';
import { t } from '../i18n.js';

const REPORT_LIMIT = 8000;
const DEFAULT_WAIT_SECONDS = 600;

const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
/** First line of a markdown report as plain text, for the one-line activity column. */
const headline = (text) =>
  (text.split('\n').find((l) => l.trim()) ?? '')
    // Unwrap paired markers only, so globs like **/*.js survive.
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^\s*(#+|>|-)\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();

/** "Edit(src/app.js)" — what a subagent is doing right now, for the live panel. */
export function describeToolCall(block, cwd) {
  const tool = getTool(block.name);
  if (!tool) return block.name;
  const arg = tool.renderInput(block.input ?? {}, { cwd }) || '';
  return `${tool.userFacingName(block.input)}${arg ? `(${shorten(arg, 48)})` : ''}`;
}

/** The text of the agent's final answer: its last assistant turn, or anything it said. */
export function finalText(messages) {
  const assistant = messages.filter((m) => m.role === 'assistant');
  for (let i = assistant.length - 1; i >= 0; i--) {
    const text = assistant[i].content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (text) return text;
  }
  return '';
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const fmt = (v, suffix = '') => (v == null ? '—' : `${v}${suffix}`);

export function catalogTable(models = enabledModels()) {
  const rows = models.map((m) =>
    [
      m.id,
      FAMILIES[m.family].label,
      m.cost == null ? '—' : `×${m.cost}`,
      fmt(m.quality, '%'),
      fmt(m.uptime, '%') + (m.uptime != null && m.uptime < UNRELIABLE_UPTIME ? ' ⚠' : ''),
      fmtContext(m.context),
      m.reasoning.length ? m.reasoning.join('') : '—',
      m.inputs ? m.inputs.join('/') : '?',
    ].join(' | '),
  );
  return ['| model | provider | cost | quality | uptime | context | reasoning | inputs |', '|---|---|---|---|---|---|---|---|', ...rows.map((r) => `| ${r} |`)].join('\n');
}

export function orchestratorPrompt(cwd) {
  const models = enabledModels();
  const language = settings.language === 'ru' ? 'Russian' : 'English';
  return [
    'You are the orchestrator of Zero Code, an AI coding CLI. You act as a lead engineer: you plan the work and delegate it to subagents, each running an AI model you choose.',
    'You do not edit files or run commands yourself; subagents do that. You may read and search the project (Read, Glob, Grep, LS) to plan and to check results, and you track the plan with TodoWrite.',
    '',
    '# Workflow',
    '1. Understand the request. If needed, look at the relevant code first, briefly.',
    '2. Break the work into self-contained tasks. Independent tasks should run in parallel; a task that depends on another starts after that one finishes.',
    '3. For each task pick the most suitable model from the catalog below and call spawn_agent with complete instructions. Start all independent tasks before waiting.',
    '4. Call wait_agents to collect the reports. Review them critically and check important claims against the code.',
    '5. If an agent failed or did poor work, try again with clearer instructions or a different model.',
    '6. Finish with a short summary for the user: what was done, by which agents, what changed, and anything left open.',
    '',
    '# Writing tasks',
    '- A subagent sees only its task text, not this conversation. Include the goal, file paths, constraints, how to verify, and what to report back.',
    '- Never let two agents that run at the same time edit the same file. Split work by file, or run such tasks one after another.',
    '- One agent per concern; keep tasks focused.',
    `- At most ${orchConfig.maxParallel} agents run at the same time; extra ones wait in a queue.`,
    '- Simple questions you can answer from what you already read: answer directly instead of spawning agents.',
    '',
    '# Choosing models',
    '- cost is the price multiplier (lower is cheaper). quality is a benchmark score (higher is better; — means not rated). uptime is availability.',
    '- Cheap models for simple or mechanical work: searching, summarising, boilerplate, small edits, writing docs.',
    '- Strong models for hard reasoning: architecture, subtle bugs, large refactors, security-sensitive code.',
    `- Avoid models with uptime below ${UNRELIABLE_UPTIME}% (marked ⚠) for important work. If an agent fails with an API error, retry the task on a model from another provider.`,
    '- Check the context window when a task involves large inputs, and the inputs column when it involves images, audio, video or PDFs.',
    '- Use a reasoning level ("reasoning": low/medium/high/xhigh) only on models that list it; higher costs more and is slower.',
    '',
    '# Model catalog (only these models are available)',
    catalogTable(models),
    '',
    `Available subagent models: ${models.map((m) => m.id).join(', ')}`,
    '',
    '# Environment',
    `Working directory: ${cwd}`,
    `Platform: ${process.platform}`,
    `Date: ${new Date().toDateString()}`,
    `Reply in ${language} unless the user writes in another language.`,
  ].join('\n');
}

export const SUBAGENT_PROMPT = [
  '# You are a subagent',
  'An orchestrator gave you one task that is part of a larger job. You run unattended and cannot ask questions: make reasonable assumptions and state them in your report.',
  'Work only on your task. Other agents may be editing other files at the same time, so do not change files outside your task unless it requires it.',
  'When you are done, reply with a short report: what you did, which files you changed, how you verified it, and any problems or open questions. The orchestrator sees only that report.',
].join('\n');

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * One /orch run: owns the subagents, starts them up to the parallel limit, collects
 * their reports and tells the UI what is happening.
 */
export class Orchestration {
  /**
   * cwd, signal                 working directory and the run's abort signal
   * permissionMode()            current permission mode (read live, so shift+tab applies to agents too)
   * allowRules                  shared "don't ask again" rules
   * requestPermission(req)      ask the user; req.agent says which agent is asking
   * onModeChange(mode)          an agent's dialog switched the mode (e.g. "allow all edits")
   * onChange()                  something changed; the UI should re-render
   */
  constructor({ cwd, signal, permissionMode, allowRules, requestPermission, onModeChange, onChange }) {
    this.cwd = cwd;
    this.signal = signal;
    this.permissionMode = permissionMode;
    this.allowRules = allowRules;
    this.requestPermission = requestPermission;
    this.onModeChange = onModeChange;
    this.onChange = onChange ?? (() => {});
    this.agents = [];
    this.startedAt = Date.now();
    this.orchestrator = { model: orchConfig.orchestrator, activity: t('orch.planning'), status: 'running' };
    signal?.addEventListener('abort', () => this.cancelAll(), { once: true });
  }

  /** The orchestrator's own engine: read-only tools plus the orchestration tools. */
  createOrchestratorEngine() {
    return new Engine({
      cwd: this.cwd,
      provider: createProvider(profileForModel(orchConfig.orchestrator, '', { agent: false })),
      permissionMode: this.permissionMode(),
      allowRules: this.allowRules,
      tools: [ReadTool, GlobTool, GrepTool, LSTool, TodoWriteTool, ...ORCH_TOOLS],
      systemPrompt: () => orchestratorPrompt(this.cwd),
      context: { orch: this },
    });
  }

  setOrchestratorActivity(activity, status) {
    this.orchestrator.activity = activity;
    if (status) this.orchestrator.status = status;
    this.onChange();
  }

  /** Error message for an invalid spawn_agent call, or null. */
  validateSpawn(input) {
    if (!input?.task?.trim()) return 'task is required';
    const model = getModel(input.model);
    if (!model) return `Unknown model "${input.model}". Available: ${enabledModels().map((m) => m.id).join(', ')}`;
    if (!orchConfig.enabled.includes(model.id)) return `Model "${model.id}" is disabled in /orch-setup. Available: ${enabledModels().map((m) => m.id).join(', ')}`;
    return null;
  }

  spawn({ model, task, name, reasoning }) {
    const n = this.agents.length + 1;
    let resolveDone;
    const agent = {
      id: `agent-${n}`,
      n,
      name: (name || task).split('\n')[0].trim().slice(0, 60),
      model,
      task,
      reasoning: reasoning || '',
      status: 'queued',
      activity: t('orch.queued'),
      queuedAt: Date.now(),
      startedAt: null,
      endedAt: null,
      report: null,
      error: null,
      toolCalls: 0,
      reported: false,
      engine: null,
      ac: new AbortController(),
    };
    agent.done = new Promise((r) => (resolveDone = r));
    agent.resolveDone = resolveDone;
    this.agents.push(agent);
    this.#pump();
    this.onChange();
    return agent;
  }

  #running() {
    return this.agents.filter((a) => a.status === 'running').length;
  }

  #pump() {
    while (this.#running() < orchConfig.maxParallel) {
      const next = this.agents.find((a) => a.status === 'queued');
      if (!next) return;
      this.#run(next);
    }
  }

  async #run(agent) {
    agent.status = 'running';
    agent.startedAt = Date.now();
    agent.activity = t('orch.starting');
    const engine = new Engine({
      cwd: this.cwd,
      provider: createProvider(profileForModel(agent.model, agent.reasoning)),
      permissionMode: this.permissionMode(),
      allowRules: this.allowRules,
      systemExtra: SUBAGENT_PROMPT,
    });
    agent.engine = engine;
    this.onChange();

    const ui = {
      onText: (id, text, done) => {
        agent.activity = t('orch.writing');
        if (done) agent.lastText = text;
        this.onChange();
      },
      onToolStart: (block) => {
        agent.toolCalls++;
        agent.activity = describeToolCall(block, engine.cwd);
        this.onChange();
      },
      onToolEnd: () => {},
      onTokens: () => {},
      onModeChange: (mode) => {
        for (const a of this.agents) if (a.engine) a.engine.permissionMode = mode;
        this.onModeChange?.(mode);
      },
      requestPermission: (req) => {
        agent.activity = t('orch.waitingPermission');
        this.onChange();
        return this.requestPermission({ ...req, agent: { n: agent.n, model: agent.model, name: agent.name } });
      },
    };

    try {
      await engine.runTurn(agent.task, ui, agent.ac.signal);
      agent.report = finalText(engine.messages) || '(the agent finished without a report)';
      agent.status = 'done';
      agent.activity = shorten(headline(agent.report), 70);
    } catch (e) {
      if (e instanceof AbortError || agent.ac.signal.aborted) {
        agent.status = 'cancelled';
        agent.activity = t('orch.cancelled');
      } else {
        agent.status = 'failed';
        agent.error = String(e.message || e);
        agent.activity = shorten(agent.error, 70);
      }
    } finally {
      agent.endedAt = Date.now();
      agent.resolveDone();
      this.onChange();
      this.#pump();
    }
  }

  #report(a) {
    const elapsed = a.startedAt ? Math.round(((a.endedAt ?? Date.now()) - a.startedAt) / 1000) : 0;
    const r = {
      agent_id: a.id,
      name: a.name,
      model: a.model,
      status: a.status,
      elapsed_seconds: elapsed,
      tool_calls: a.toolCalls,
    };
    if (a.engine) {
      r.lines_added = a.engine.stats.linesAdded;
      r.lines_removed = a.engine.stats.linesRemoved;
    }
    if (a.status === 'done') r.report = a.report.length > REPORT_LIMIT ? a.report.slice(0, REPORT_LIMIT) + '\n[report truncated]' : a.report;
    if (a.status === 'failed') r.error = a.error;
    if (a.status === 'running' || a.status === 'queued') r.activity = a.activity;
    return r;
  }

  /** Wait for agents (default: every agent whose report wasn't collected yet) and return their reports. */
  async wait(ids, timeoutSeconds = DEFAULT_WAIT_SECONDS, signal) {
    const targets = ids?.length ? this.agents.filter((a) => ids.includes(a.id)) : this.agents.filter((a) => !a.reported);
    if (ids?.length && targets.length !== ids.length) {
      const missing = ids.filter((id) => !this.agents.some((a) => a.id === id));
      throw new Error(`Unknown agent id(s): ${missing.join(', ')}`);
    }
    if (!targets.length) return [];
    this.setOrchestratorActivity(t('orch.waitingFor', { n: targets.filter((a) => !a.endedAt).length }));

    let timer;
    const timeout = new Promise((r) => (timer = setTimeout(r, Math.max(1, Number(timeoutSeconds) || DEFAULT_WAIT_SECONDS) * 1000)));
    const aborted = new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new AbortError()), { once: true }));
    try {
      await Promise.race([Promise.all(targets.map((a) => a.done)), timeout, aborted]);
    } finally {
      clearTimeout(timer);
    }
    for (const a of targets) if (a.endedAt) a.reported = true;
    this.setOrchestratorActivity(t('orch.reviewing'));
    return targets.map((a) => this.#report(a));
  }

  status() {
    return this.agents.map((a) => this.#report(a));
  }

  cancel(id) {
    const a = this.agents.find((x) => x.id === id);
    if (!a || a.endedAt) return false;
    if (a.status === 'queued') {
      a.status = 'cancelled';
      a.activity = t('orch.cancelled');
      a.endedAt = Date.now();
      a.resolveDone();
      this.onChange();
    } else a.ac.abort();
    return true;
  }

  cancelAll() {
    for (const a of this.agents) if (!a.endedAt) this.cancel(a.id);
  }

  /** What the live panel draws. */
  snapshot() {
    return {
      startedAt: this.startedAt,
      orchestrator: { ...this.orchestrator },
      agents: this.agents.map(({ id, n, name, model, status, activity, queuedAt, startedAt, endedAt, toolCalls }) => ({
        id, n, name, model, status, activity, queuedAt, startedAt, endedAt, toolCalls,
      })),
    };
  }
}

/** Where each model of the catalog would be sent, for /orch-setup and error messages. */
export function routeSummary() {
  return Object.keys(FAMILIES).map((family) => {
    const p = routeFor(CATALOG.find((m) => m.family === family).id);
    return { family, profile: p };
  });
}
