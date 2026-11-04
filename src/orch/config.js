import fs from 'node:fs';
import path from 'node:path';
import { ZERO_HOME } from '../utils/config.js';
import { CATALOG, FAMILIES, getModel } from './catalog.js';
import { activeProfile, getProfile } from '../utils/profiles.js';

/**
 * Orchestration settings, saved in ~/.zero/orch.json:
 *   orchestrator  model id that plans and delegates
 *   routes        family -> profile id that serves that family's models ('' = the active profile)
 *   enabled       model ids subagents may use
 *   maxParallel   how many subagents may run at the same time
 *   agentReasoning default reasoning level for subagents ('' = model default)
 */
const ORCH_FILE = path.join(ZERO_HOME, 'orch.json');

export const DEFAULTS = {
  orchestrator: 'claude-opus-5-5',
  routes: Object.fromEntries(Object.keys(FAMILIES).map((f) => [f, ''])),
  enabled: CATALOG.map((m) => m.id),
  maxParallel: 3,
  agentReasoning: '',
};

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(ORCH_FILE, 'utf8'));
    return {
      orchestrator: getModel(raw.orchestrator) ? raw.orchestrator : DEFAULTS.orchestrator,
      routes: { ...DEFAULTS.routes, ...(raw.routes ?? {}) },
      enabled: Array.isArray(raw.enabled) ? raw.enabled.filter(getModel) : DEFAULTS.enabled,
      maxParallel: Math.min(8, Math.max(1, Number(raw.maxParallel) || DEFAULTS.maxParallel)),
      agentReasoning: ['', 'low', 'medium', 'high', 'xhigh'].includes(raw.agentReasoning) ? raw.agentReasoning : '',
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const orchConfig = load();

export function saveOrchConfig(patch = {}) {
  Object.assign(orchConfig, patch);
  fs.mkdirSync(ZERO_HOME, { recursive: true });
  fs.writeFileSync(ORCH_FILE + '.tmp', JSON.stringify(orchConfig, null, 2));
  fs.renameSync(ORCH_FILE + '.tmp', ORCH_FILE);
}

/** The profile that serves a model: its family's route, or the active profile. */
export function routeFor(modelId) {
  const family = getModel(modelId)?.family;
  const routed = family && orchConfig.routes[family] ? getProfile(orchConfig.routes[family]) : null;
  return routed ?? activeProfile();
}

/**
 * A profile copy that asks for this model (and reasoning level) through its route.
 * Subagents fall back to the "default agent reasoning" setting; the orchestrator does not.
 */
export function profileForModel(modelId, reasoning = '', { agent = true } = {}) {
  const base = routeFor(modelId);
  if (base.type === 'mock') return base;
  const level = reasoning || (agent ? orchConfig.agentReasoning : '');
  const p = { ...base, model: modelId };
  if (level) {
    if (base.type === 'anthropic') p.effort = level;
    else p.reasoningEffort = level;
  }
  return p;
}

export const enabledModels = () => CATALOG.filter((m) => orchConfig.enabled.includes(m.id));

export const ORCH_PATH = ORCH_FILE;
