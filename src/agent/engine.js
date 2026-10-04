import fs from 'node:fs';
import path from 'node:path';
import { getTool, toolSchemas } from '../tools/index.js';
import { checkPermission, alwaysAllowOption } from './permissions.js';
import { MEMORY_FILE } from '../utils/config.js';
import { settings } from '../utils/settings.js';

let idCounter = 0;
export const newId = (p = 'id') => `${p}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export const REJECT_MESSAGE =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
export const INTERRUPT_MESSAGE = '[Request interrupted by user]';

export class AbortError extends Error {
  constructor() {
    super('Interrupted');
    this.name = 'AbortError';
  }
}

const estimateTokens = (s) => Math.ceil((s?.length ?? 0) / 4);

/**
 * Owns the conversation and runs the agent loop:
 * model -> tool_use -> permission -> tool -> tool_result -> model ... until the model stops.
 */
export class Engine {
  constructor({ cwd, provider, permissionMode = 'default' }) {
    this.cwd = cwd;
    this.originalCwd = cwd;
    this.provider = provider;
    this.permissionMode = permissionMode;
    this.messages = [];
    this.allowRules = new Set();
    this.readFiles = new Map();
    this.todos = [];
    // How each tool call ended ({ status, display, error }), keyed by tool_use id,
    // so a saved chat can be redrawn exactly as it looked.
    this.displays = {};
    // Token usage of the most recent API call, when the provider reports it.
    this.lastUsage = null;
    this.stats = {
      inputTokens: 0,
      outputTokens: 0,
      apiMs: 0,
      startedAt: Date.now(),
      linesAdded: 0,
      linesRemoved: 0,
      turns: 0,
      toolCalls: 0,
    };
  }

  systemPrompt() {
    let memory = '';
    const file = path.join(this.originalCwd, MEMORY_FILE);
    try {
      if (fs.existsSync(file)) memory = `\n\nProject instructions (${MEMORY_FILE}):\n${fs.readFileSync(file, 'utf8')}`;
    } catch {}
    const language = settings.language === 'ru' ? 'Russian' : 'English';
    return (
      [
        'You are Zero-chan, the cheerful pixel-art mascot and coding agent of Zero Code, an interactive CLI for software engineering tasks.',
        'You help the user by reading, searching and editing files and running shell commands with the tools provided.',
        '',
        '# How to work',
        '- Look before you act: Read a file before editing it (Edit and Write refuse files that were not read first).',
        '- Prefer Edit for changes to existing files; old_string must match the file exactly and be unique.',
        '- Use Glob, Grep and LS to find things instead of guessing paths.',
        '- For multi-step work, keep a todo list with TodoWrite and update it as you go.',
        '- Keep answers short and direct, in GitHub-flavored markdown. Do not narrate every step.',
        '- If the user rejects a tool call, stop and wait for their instructions.',
        `- Reply in ${language} unless the user writes in another language.`,
        '',
        '# Environment',
        `Working directory: ${this.cwd}`,
        `Platform: ${process.platform}`,
        `Shell: ${process.platform === 'win32' ? 'Git Bash (POSIX syntax), falling back to PowerShell' : 'bash'}`,
        `Date: ${new Date().toDateString()}`,
      ].join('\n') + memory
    );
  }

  toolContext(signal) {
    const engine = this;
    return {
      get cwd() {
        return engine.cwd;
      },
      setCwd: (c) => (engine.cwd = c),
      readFiles: this.readFiles,
      todos: this.todos,
      stats: this.stats,
      signal,
      defaultTimeout: settings.bashTimeout * 1000,
    };
  }

  clear() {
    this.messages = [];
    this.readFiles.clear();
    this.todos.splice(0);
    this.displays = {};
    this.lastUsage = null;
  }

  /** Tokens the current chat occupies in the model's context (estimated unless the API reported usage). */
  contextTokens() {
    const estimate = estimateTokens(this.systemPrompt()) + estimateTokens(JSON.stringify(this.messages));
    if (!this.lastUsage) return this.messages.length ? estimate : 0;
    return Math.max(estimate, this.lastUsage.input + this.lastUsage.output);
  }

  /** Everything needed to resume this chat later. */
  serialize() {
    return { messages: this.messages, todos: this.todos, displays: this.displays, cwd: this.cwd, lastUsage: this.lastUsage };
  }

  restore(data) {
    this.clear();
    this.messages = data.messages ?? [];
    this.todos.push(...(data.todos ?? []));
    this.displays = data.displays ?? {};
    this.lastUsage = data.lastUsage ?? null;
    if (data.cwd && fs.existsSync(data.cwd)) this.cwd = data.cwd;
  }

  /**
   * Run one user turn.
   * ui: { onText(id, text, done), onToolStart(block), onToolEnd(id, outcome), requestPermission(req), onTokens(n) }
   * Resolves to 'done' | 'rejected'; throws AbortError when interrupted.
   */
  async runTurn(userText, uiIn, signal) {
    const ui = {
      ...uiIn,
      onToolEnd: (id, outcome) => {
        const { status, display, error, silent } = outcome;
        this.displays[id] = { status, display, error, silent };
        uiIn.onToolEnd(id, outcome);
      },
    };
    this.stats.turns++;
    this.messages.push({ role: 'user', content: [{ type: 'text', text: userText }] });
    try {
      for (;;) {
        const blocks = await this.#streamAssistant(ui, signal);
        this.messages.push({ role: 'assistant', content: blocks });
        const toolUses = blocks.filter((b) => b.type === 'tool_use');
        const stop = this.lastStop?.reason;
        if (stop === 'refusal') {
          ui.onText(newId('msg'), `_The model declined this request${this.lastStop.details?.category ? ` (${this.lastStop.details.category})` : ''}._`, true);
        }
        if (!toolUses.length) return 'done';

        // A declined turn, or one cut off at max_tokens, may carry incomplete tool calls: never run them.
        if (stop === 'refusal' || stop === 'max_tokens') {
          const why = stop === 'refusal' ? 'Not run: the model declined this turn.' : 'Not run: the response hit max_tokens before the tool call was complete.';
          for (const tu of toolUses) {
            ui.onToolStart(tu);
            ui.onToolEnd(tu.id, { status: 'error', error: why });
          }
          this.messages.push({ role: 'user', content: toolUses.map((tu) => ({ type: 'tool_result', tool_use_id: tu.id, content: why, is_error: true })) });
          return 'done';
        }

        const results = [];
        let rejected = false;
        for (const tu of toolUses) {
          if (rejected) {
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: REJECT_MESSAGE, is_error: true });
            ui.onToolEnd(tu.id, { status: 'rejected', silent: true });
            continue;
          }
          const res = await this.#runTool(tu, ui, signal, results);
          results.push(res.result);
          if (res.rejected) rejected = true;
        }
        this.messages.push({ role: 'user', content: results });
        if (rejected) return 'rejected';
      }
    } catch (err) {
      if (err instanceof AbortError || signal.aborted) {
        this.#repairAfterInterrupt();
        throw new AbortError();
      }
      throw err;
    }
  }

  async #streamAssistant(ui, signal) {
    const blocks = [];
    let text = '';
    let textId = null;
    const flush = () => {
      if (textId && text.trim()) {
        blocks.push({ type: 'text', text });
        ui.onText(textId, text, true);
      }
      text = '';
      textId = null;
    };
    const started = Date.now();
    const inputTokens = estimateTokens(JSON.stringify(this.messages)) + estimateTokens(this.systemPrompt());
    let outTokens = 0;
    let reportedInput = 0;
    let finalBlocks = null;
    this.lastStop = null;
    const stream = this.provider.stream({
      system: this.systemPrompt(),
      messages: this.messages,
      tools: toolSchemas(),
      signal,
      cwd: this.cwd,
      todos: this.todos,
    });
    for await (const ev of stream) {
      if (signal.aborted) throw new AbortError();
      if (ev.type === 'text_delta') {
        if (!textId) textId = newId('msg');
        text += ev.text;
        outTokens += estimateTokens(ev.text);
        ui.onTokens?.(outTokens);
        ui.onText(textId, text, false);
      } else if (ev.type === 'usage') {
        // Real token counts reported by the API replace the estimates.
        if (ev.outputTokens) outTokens = ev.outputTokens;
        if (ev.inputTokens) reportedInput = ev.inputTokens;
        ui.onTokens?.(outTokens);
      } else if (ev.type === 'final_blocks') {
        // The provider handed back the exact turn the API returned; store that verbatim
        // (thinking blocks and all) instead of the blocks assembled from deltas.
        finalBlocks = ev.blocks;
        this.lastStop = { reason: ev.stopReason, details: ev.stopDetails };
      } else if (ev.type === 'tool_use') {
        flush();
        outTokens += estimateTokens(JSON.stringify(ev.input));
        ui.onTokens?.(outTokens);
        blocks.push({ type: 'tool_use', id: ev.id ?? newId('toolu'), name: ev.name, input: ev.input });
      }
    }
    flush();
    this.stats.apiMs += Date.now() - started;
    this.stats.inputTokens += reportedInput || inputTokens;
    if (reportedInput) this.lastUsage = { input: reportedInput, output: outTokens };
    this.stats.outputTokens += outTokens;
    return finalBlocks ?? blocks;
  }

  async #runTool(tu, ui, signal) {
    const tool = getTool(tu.name);
    const fail = (msg, status = 'error') => {
      ui.onToolEnd(tu.id, { status, error: msg });
      return { result: { type: 'tool_result', tool_use_id: tu.id, content: msg, is_error: true } };
    };
    ui.onToolStart(tu);
    if (!tool) return fail(`Error: No such tool available: ${tu.name}`);
    this.stats.toolCalls++;
    const ctx = this.toolContext(signal);

    const invalid = tool.validate?.(tu.input, ctx);
    if (invalid) return fail(invalid);

    const perm = checkPermission(tool, tu.input, this);
    if (perm.behavior === 'deny') return fail(perm.message);
    if (perm.behavior === 'ask') {
      const always = alwaysAllowOption(tool, tu.input, this.cwd);
      const answer = await ui.requestPermission({
        id: tu.id,
        tool,
        input: tu.input,
        preview: tool.preview?.(tu.input, ctx),
        always,
        cwd: this.cwd,
      });
      if (signal.aborted) throw new AbortError();
      if (answer === 'no') {
        ui.onToolEnd(tu.id, { status: 'rejected' });
        return {
          rejected: true,
          result: { type: 'tool_result', tool_use_id: tu.id, content: REJECT_MESSAGE, is_error: true },
        };
      }
      if (answer === 'always') {
        if (always.mode) {
          this.permissionMode = always.mode;
          ui.onModeChange?.(always.mode);
        }
        if (always.rule) this.allowRules.add(always.rule);
      }
    }

    try {
      const out = await tool.call(tu.input, ctx);
      ui.onToolEnd(tu.id, { status: out.isError ? 'error' : 'done', display: out.display });
      return { result: { type: 'tool_result', tool_use_id: tu.id, content: out.output, is_error: !!out.isError } };
    } catch (e) {
      if (e.interrupted || e.name === 'AbortError' || signal.aborted) {
        ui.onToolEnd(tu.id, { status: 'interrupted' });
        throw new AbortError();
      }
      return fail(e.message);
    }
  }

  /** Make sure every tool_use has a result and note the interruption, so the transcript stays valid. */
  #repairAfterInterrupt() {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === 'assistant') {
      const pending = last.content.filter((b) => b.type === 'tool_use');
      if (pending.length) {
        this.messages.push({
          role: 'user',
          content: pending.map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: INTERRUPT_MESSAGE, is_error: true })),
        });
      }
    }
    this.messages.push({ role: 'user', content: [{ type: 'text', text: INTERRUPT_MESSAGE }] });
  }
}
