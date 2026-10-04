import { MockProvider } from './mock.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { activeProfile } from '../utils/profiles.js';

/**
 * Providers turn a transcript into a stream of events:
 *   { type: 'text_delta', text }
 *   { type: 'tool_use', id, name, input }
 *   { type: 'usage', inputTokens, outputTokens }                 (optional)
 *   { type: 'final_blocks', blocks, stopReason, stopDetails }    (optional: exact stored turn)
 *
 * `stream({ system, messages, tools, signal, cwd, todos })` receives messages in the
 * Anthropic Messages format and tool schemas as { name, description, input_schema }.
 */
export function createProvider(profile = activeProfile()) {
  switch (profile?.type) {
    case 'openai':
      return new OpenAIProvider(profile);
    case 'anthropic':
      return new AnthropicProvider(profile);
    default:
      return new MockProvider();
  }
}
