/**
 * Models available to orchestration, with the provider-catalog stats they were listed with.
 *
 *   cost     price multiplier (×1 = baseline; lower is cheaper)
 *   quality  quality score in % (null = not rated yet)
 *   uptime   availability in % over the provider's window
 *   context  context window in tokens
 *   reasoning  supported reasoning levels: L(ow) M(edium) H(igh) X(-high); [] = no reasoning control
 *   inputs   accepted input types
 *
 * Fields left null were not published for that model.
 */
const T = ['text'];
const TI = ['text', 'image'];
const TIV = ['text', 'image', 'video'];
const ALL = ['text', 'image', 'audio', 'video', 'pdf'];
const LMHX = ['L', 'M', 'H', 'X'];
const M = 1_000_000;

export const FAMILIES = {
  claude: { label: 'Claude (Anthropic)', preferredType: 'anthropic' },
  openai: { label: 'ChatGPT (OpenAI)', preferredType: 'openai' },
  gemini: { label: 'Gemini (Google)', preferredType: 'openai' },
  kimi: { label: 'Kimi', preferredType: 'openai' },
  deepseek: { label: 'DeepSeek', preferredType: 'openai' },
};

export const CATALOG = [
  // ---- DeepSeek ---------------------------------------------------------------
  { id: 'deepseek-v4.1-flash', family: 'deepseek', uptime: 94.96, cost: 0.1, quality: 105, context: 1.05 * M, reasoning: LMHX, inputs: TI },
  { id: 'deepseek-v4-pro', family: 'deepseek', uptime: 99.73, cost: 0.5, quality: 95, context: 1.05 * M, reasoning: LMHX, inputs: T },
  { id: 'deepseek-v4-flash', family: 'deepseek', uptime: null, cost: null, quality: null, context: null, reasoning: [], inputs: T },

  // ---- Claude (Anthropic) -------------------------------------------------------
  { id: 'claude-fable-5-1', family: 'claude', uptime: 97.34, cost: 8, quality: 139, context: 1 * M, reasoning: LMHX, inputs: TI },
  { id: 'claude-fable-5', family: 'claude', uptime: 96.93, cost: 8, quality: 132, context: 1 * M, reasoning: LMHX, inputs: TI },
  { id: 'claude-opus-5-5', family: 'claude', uptime: 100, cost: 4, quality: null, context: 1 * M, reasoning: LMHX, inputs: TI },
  { id: 'claude-opus-5', family: 'claude', uptime: 85.35, cost: 4, quality: 134, context: 1 * M, reasoning: LMHX, inputs: TI },
  { id: 'claude-sonnet-5-5', family: 'claude', uptime: 100, cost: 2, quality: null, context: 1 * M, reasoning: LMHX, inputs: TI },
  { id: 'claude-sonnet-5', family: 'claude', uptime: 89.73, cost: 2, quality: 100, context: 1 * M, reasoning: LMHX, inputs: TI },
  { id: 'claude-opus-4-8', family: 'claude', uptime: 88.95, cost: 4, quality: 111, context: 1 * M, reasoning: LMHX, inputs: TI },
  { id: 'claude-opus-4-7', family: 'claude', uptime: 90.07, cost: 4, quality: 108, context: 1 * M, reasoning: LMHX, inputs: TI },
  { id: 'claude-opus-4-6', family: 'claude', uptime: 96.23, cost: 4, quality: 84, context: 200_000, reasoning: LMHX, inputs: TI },
  { id: 'claude-haiku-5-5', family: 'claude', uptime: 14.29, cost: 1.3, quality: null, context: 1 * M, reasoning: LMHX, inputs: TI },
  { id: 'claude-haiku-4-5', family: 'claude', uptime: 76.31, cost: 0.9, quality: 47, context: 200_000, reasoning: [], inputs: TI },
  { id: 'claude-sonnet-4-6', family: 'claude', uptime: 88.78, cost: 2, quality: 79, context: 200_000, reasoning: LMHX, inputs: TI },

  // ---- ChatGPT (OpenAI) ---------------------------------------------------------
  { id: 'gpt-6-astra', family: 'openai', uptime: 98.6, cost: 10, quality: 139, context: 1.05 * M, reasoning: LMHX, inputs: TI },
  { id: 'gpt-6.1-sol', family: 'openai', uptime: 97.23, cost: 3, quality: null, context: 1.05 * M, reasoning: LMHX, inputs: TI },
  { id: 'gpt-6-sol', family: 'openai', uptime: 99.85, cost: 3, quality: 130, context: 1.05 * M, reasoning: LMHX, inputs: TI },
  { id: 'gpt-6.1-terra', family: 'openai', uptime: 98.94, cost: 0.7, quality: null, context: 1.05 * M, reasoning: LMHX, inputs: TI },
  { id: 'gpt-6-luna', family: 'openai', uptime: 99.56, cost: 0.38, quality: 100, context: 1.05 * M, reasoning: LMHX, inputs: TI },
  { id: 'gpt-5.6-sol', family: 'openai', uptime: 99, cost: 4, quality: 124, context: 1.05 * M, reasoning: LMHX, inputs: TI },
  { id: 'gpt-5.6-terra', family: 'openai', uptime: 99.21, cost: 1.3, quality: 111, context: 1.05 * M, reasoning: LMHX, inputs: TI },
  { id: 'gpt-5.6-luna', family: 'openai', uptime: 99.85, cost: 0.5, quality: 100, context: 1.05 * M, reasoning: LMHX, inputs: TI },

  // ---- Gemini (Google) ----------------------------------------------------------
  { id: 'gemini-3.8-flash', family: 'gemini', uptime: 99.94, cost: 2, quality: 108, context: 1.05 * M, reasoning: LMHX, inputs: ALL },
  { id: 'gemini-3.7-flash', family: 'gemini', uptime: 99.95, cost: 2, quality: 105, context: 1.05 * M, reasoning: LMHX, inputs: ALL },
  { id: 'gemini-3.6-flash', family: 'gemini', uptime: 99.96, cost: 2, quality: 89, context: 1.05 * M, reasoning: LMHX, inputs: ALL },
  { id: 'gemini-3.1-pro', family: 'gemini', uptime: 99.94, cost: 2, quality: 79, context: 1.05 * M, reasoning: LMHX, inputs: null },

  // ---- Kimi -------------------------------------------------------------------
  { id: 'kimi-k3.1-pro', family: 'kimi', uptime: 95.96, cost: 2, quality: null, context: 1.05 * M, reasoning: LMHX, inputs: TIV },
  { id: 'kimi-k3', family: 'kimi', uptime: 99.73, cost: 2.5, quality: 116, context: 1 * M, reasoning: LMHX, inputs: ALL },
  { id: 'kimi-k2.8-preview', family: 'kimi', uptime: 73.13, cost: 0.9, quality: null, context: 1.05 * M, reasoning: LMHX, inputs: TIV },
  { id: 'kimi-k2.7-code', family: 'kimi', uptime: 98.53, cost: 0.9, quality: 68, context: 262_000, reasoning: LMHX, inputs: TIV },
];

export const getModel = (id) => CATALOG.find((m) => m.id === id) ?? null;

export const fmtContext = (n) => (n == null ? '?' : n >= M ? `${+(n / M).toFixed(2)}M` : `${Math.round(n / 1000)}K`);

/** Reasoning levels as the APIs name them. */
export const REASONING_LEVELS = { L: 'low', M: 'medium', H: 'high', X: 'xhigh' };

/** Models with low availability: the orchestrator is told to avoid them for important work. */
export const UNRELIABLE_UPTIME = 90;
