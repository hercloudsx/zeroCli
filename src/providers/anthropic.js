import Anthropic from '@anthropic-ai/sdk';
import { hostOf } from '../utils/profiles.js';

/**
 * The Anthropic Messages API (Claude), via the official SDK. The engine's transcript
 * is already in this format, and assistant turns are stored exactly as the API
 * returned them (thinking blocks included), so history replays unchanged.
 */

const OFFICIAL_HOST = 'api.anthropic.com';

/** The SDK wants the origin; accept ".../v1" too since that's how most docs write it. */
const sdkBaseUrl = (url) => (url || `https://${OFFICIAL_HOST}`).replace(/\/+$/, '').replace(/\/v1$/, '');

/** Drop turns with no content (e.g. a model reply that produced nothing). */
const toApiMessages = (messages) => messages.filter((m) => Array.isArray(m.content) && m.content.length);

export class AnthropicProvider {
  constructor(profile) {
    this.profile = profile;
    this.name = 'anthropic';
    const apiKey = profile.apiKey || process.env.ANTHROPIC_API_KEY || process.env.ZERO_API_KEY;
    this.client = new Anthropic({ apiKey: apiKey || 'missing-key', baseURL: sdkBaseUrl(profile.baseUrl) });
    this.hasKey = !!apiKey;
  }

  get official() {
    return hostOf(sdkBaseUrl(this.profile.baseUrl)) === OFFICIAL_HOST;
  }

  get label() {
    return this.profile.model || this.profile.name;
  }

  get description() {
    return `${this.profile.name} · ${hostOf(sdkBaseUrl(this.profile.baseUrl))}`;
  }

  #params({ system, messages, tools }) {
    const params = {
      model: this.profile.model,
      max_tokens: Number(this.profile.maxTokens) || 64000,
      system,
      messages: toApiMessages(messages),
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
    };
    if (this.profile.effort) params.output_config = { effort: this.profile.effort };
    return params;
  }

  async *stream(args) {
    if (!this.profile.model) throw new Error(`Profile "${this.profile.name}" has no model. Set one with /model <name> or in /profiles.`);
    if (!this.hasKey) throw new Error(`Profile "${this.profile.name}" has no API key. Add one in /profiles (or set ANTHROPIC_API_KEY).`);

    const params = this.#params(args);
    // On the first-party API, opt into server-side refusal fallbacks; proxies may not know the beta.
    const stream = this.official
      ? this.client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal: args.signal })
      : this.client.messages.stream(params, { signal: args.signal });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text_delta', text: event.delta.text };
      }
    }
    const message = await stream.finalMessage();
    yield { type: 'usage', inputTokens: message.usage?.input_tokens, outputTokens: message.usage?.output_tokens };
    // The exact blocks the API returned become the stored assistant turn.
    yield { type: 'final_blocks', blocks: message.content, stopReason: message.stop_reason, stopDetails: message.stop_details };
  }

  async listModels() {
    const ids = [];
    for await (const m of this.client.models.list()) ids.push(m.id);
    return ids;
  }
}
