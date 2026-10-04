import { newId } from '../agent/engine.js';
import { hostOf } from '../utils/profiles.js';

/**
 * Any OpenAI-compatible Chat Completions API (OpenAI, OpenRouter, Ollama, LM Studio,
 * resellers…). Streams text and tool calls back as engine events.
 */

/** Engine transcript (Anthropic-shaped) -> OpenAI chat messages. Non-text/tool blocks (e.g. Claude thinking) are skipped. */
export function toOpenAIMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const calls = m.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      if (!text && !calls.length) continue;
      const msg = { role: 'assistant', content: text || null };
      if (calls.length) msg.tool_calls = calls;
      out.push(msg);
      continue;
    }
    // user turn: tool results become `tool` messages (they must directly follow the tool calls)
    const texts = [];
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        const content = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
        out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.is_error ? `Error: ${content}` : content });
      } else if (b.type === 'text') texts.push(b.text);
    }
    if (texts.length) out.push({ role: 'user', content: texts.join('\n') });
  }
  return out;
}

export const toOpenAITools = (tools) =>
  tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));

/** Parse a Server-Sent Events stream into JSON payloads. */
async function* sseEvents(body, signal) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    if (signal?.aborted) return;
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
      const data = raw
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      if (data === '[DONE]') return;
      try {
        yield JSON.parse(data);
      } catch {
        // ignore keep-alives / malformed lines
      }
    }
  }
}

async function errorMessage(res) {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j.message || j.detail || text;
    } catch {
      detail = text;
    }
  } catch {}
  detail = String(detail).trim().slice(0, 500);
  return `${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`;
}

function toolEvent(id, name, args) {
  let input = {};
  try {
    input = args ? JSON.parse(args) : {};
  } catch {
    input = { _raw: args };
  }
  return { type: 'tool_use', id: id || newId('call'), name, input };
}

export class OpenAIProvider {
  constructor(profile) {
    this.profile = profile;
    this.name = 'openai';
  }

  get baseUrl() {
    return (this.profile.baseUrl || '').replace(/\/+$/, '');
  }

  get label() {
    return this.profile.model || this.profile.name;
  }

  get description() {
    return `${this.profile.name} · ${hostOf(this.baseUrl)}`;
  }

  #headers() {
    const h = { 'content-type': 'application/json' };
    const key = this.profile.apiKey || process.env.ZERO_API_KEY;
    if (key) h.authorization = `Bearer ${key}`;
    return h;
  }

  #check() {
    if (!this.baseUrl) throw new Error(`Profile "${this.profile.name}" has no base URL. Fix it in /profiles.`);
    if (!this.profile.model) throw new Error(`Profile "${this.profile.name}" has no model. Set one with /model <name> or in /profiles.`);
  }

  async *stream({ system, messages, tools, signal }) {
    this.#check();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { ...this.#headers(), accept: 'text/event-stream' },
      body: JSON.stringify({
        model: this.profile.model,
        messages: toOpenAIMessages(system, messages),
        ...(tools?.length ? { tools: toOpenAITools(tools), tool_choice: 'auto' } : {}),
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));

    // Some servers ignore stream:true and answer with a single JSON body.
    if ((res.headers.get('content-type') || '').includes('application/json')) {
      const j = await res.json();
      const msg = j.choices?.[0]?.message ?? {};
      if (msg.content) yield { type: 'text_delta', text: msg.content };
      for (const c of msg.tool_calls ?? []) yield toolEvent(c.id, c.function?.name, c.function?.arguments);
      if (j.usage) yield { type: 'usage', inputTokens: j.usage.prompt_tokens, outputTokens: j.usage.completion_tokens };
      return;
    }

    const calls = new Map(); // index -> { id, name, args }
    for await (const ev of sseEvents(res.body, signal)) {
      if (ev.error) throw new Error(ev.error.message || JSON.stringify(ev.error));
      const delta = ev.choices?.[0]?.delta;
      if (delta?.content) yield { type: 'text_delta', text: delta.content };
      for (const tc of delta?.tool_calls ?? []) {
        const i = tc.index ?? calls.size;
        const cur = calls.get(i) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(i, cur);
      }
      if (ev.usage) yield { type: 'usage', inputTokens: ev.usage.prompt_tokens, outputTokens: ev.usage.completion_tokens };
    }
    for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) yield toolEvent(c.id, c.name, c.args);
  }

  async listModels() {
    if (!this.baseUrl) throw new Error('No base URL');
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.#headers() });
    if (!res.ok) throw new Error(await errorMessage(res));
    const j = await res.json();
    return (j.data ?? []).map((m) => m.id).filter(Boolean).sort();
  }
}
