import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ZERO_HOME } from './config.js';

/**
 * Provider profiles: named connections (type + base URL + model + key) you can
 * switch between at any time, even mid-chat. Stored in ~/.zero/profiles.json.
 *
 * type 'openai'    — any OpenAI-compatible Chat Completions API (OpenAI, OpenRouter, Ollama, LM Studio…)
 * type 'anthropic' — the Anthropic Messages API (Claude), or a proxy speaking it
 * type 'mock'      — the built-in offline demo model (always present, not editable)
 */
const PROFILES_FILE = path.join(ZERO_HOME, 'profiles.json');
const SETTINGS_FILE = path.join(ZERO_HOME, 'settings.json');

export const MOCK_PROFILE = Object.freeze({ id: 'mock', name: 'Zero Mock', type: 'mock', builtin: true, model: 'mock', baseUrl: '' });

export const PROFILE_TYPES = ['openai', 'anthropic'];
export const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Starting points for "new profile". Model is left blank where there is no safe default. */
export const PRESETS = [
  { preset: 'anthropic', name: 'Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', effort: 'high', maxTokens: 64000 },
  { preset: 'openai', name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', model: '' },
  { preset: 'openrouter', name: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  { preset: 'ollama', name: 'Ollama', type: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  { preset: 'lmstudio', name: 'LM Studio', type: 'openai', baseUrl: 'http://localhost:1234/v1', model: '' },
  { preset: 'custom', name: 'Custom', type: 'openai', baseUrl: '', model: '' },
];

const newProfileId = () => crypto.randomBytes(4).toString('hex');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** One-time import of the old single-API settings (apiBaseUrl / apiModel / apiKey) into a profile. */
function migrate() {
  const s = readJson(SETTINGS_FILE) ?? {};
  if (!s.apiKey && s.model !== 'openai') return { active: 'mock', profiles: [] };
  const p = {
    id: newProfileId(),
    name: 'Imported',
    type: 'openai',
    baseUrl: s.apiBaseUrl || '',
    model: s.apiModel || '',
    apiKey: s.apiKey || '',
  };
  return { active: s.model === 'openai' ? p.id : 'mock', profiles: [p] };
}

function load() {
  const data = readJson(PROFILES_FILE);
  if (data && Array.isArray(data.profiles)) return { active: data.active || 'mock', profiles: data.profiles };
  const migrated = migrate();
  if (migrated.profiles.length) save(migrated);
  return migrated;
}

function save(data = state) {
  fs.mkdirSync(ZERO_HOME, { recursive: true });
  fs.writeFileSync(PROFILES_FILE + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(PROFILES_FILE + '.tmp', PROFILES_FILE);
}

const state = load();
const listeners = new Set();
// A --profile flag picks a profile for one run without changing the saved default.
let sessionOverride = null;

const notify = () => {
  for (const fn of listeners) fn(activeProfile());
};

/** Re-read profiles.json, e.g. after it was edited by hand while Zero Code is running. */
export function reloadProfiles() {
  const data = readJson(PROFILES_FILE);
  if (!data || !Array.isArray(data.profiles)) return false;
  state.active = data.active || 'mock';
  state.profiles = data.profiles;
  notify();
  return true;
}

export const subscribeProfiles = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export const getProfiles = () => [MOCK_PROFILE, ...state.profiles];

export const getProfile = (id) => getProfiles().find((p) => p.id === id) ?? null;

export function activeProfile() {
  return getProfile(sessionOverride ?? state.active) ?? MOCK_PROFILE;
}

/** Find by 1-based list number, id, or (partial, case-insensitive) name. */
export function findProfile(q) {
  const list = getProfiles();
  const s = String(q ?? '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s) && list[Number(s) - 1]) return list[Number(s) - 1];
  const l = s.toLowerCase();
  return list.find((p) => p.id === s) ?? list.find((p) => p.name.toLowerCase() === l) ?? list.find((p) => p.name.toLowerCase().includes(l)) ?? null;
}

export function setActiveProfile(id, { persist = true } = {}) {
  if (!getProfile(id)) return false;
  if (persist) {
    sessionOverride = null;
    state.active = id;
    save();
  } else {
    sessionOverride = id;
  }
  notify();
  return true;
}

/** Create (no id) or update a profile. Returns the stored profile. */
export function saveProfile(profile) {
  const clean = {
    id: profile.id || newProfileId(),
    name: String(profile.name || 'Profile').trim(),
    type: PROFILE_TYPES.includes(profile.type) ? profile.type : 'openai',
    baseUrl: String(profile.baseUrl || '').trim(),
    model: String(profile.model || '').trim(),
    apiKey: String(profile.apiKey || '').trim(),
    ...(profile.type === 'anthropic' ? { effort: EFFORTS.includes(profile.effort) ? profile.effort : '', maxTokens: Number(profile.maxTokens) || 64000 } : {}),
  };
  const i = state.profiles.findIndex((p) => p.id === clean.id);
  if (i === -1) state.profiles.push(clean);
  else state.profiles[i] = clean;
  save();
  notify();
  return clean;
}

export function updateActiveModel(model) {
  const p = activeProfile();
  if (p.type === 'mock') return null;
  return saveProfile({ ...p, model });
}

export function removeProfile(id) {
  const i = state.profiles.findIndex((p) => p.id === id);
  if (i === -1) return false;
  state.profiles.splice(i, 1);
  if (state.active === id) state.active = 'mock';
  if (sessionOverride === id) sessionOverride = null;
  save();
  notify();
  return true;
}

export function maskKey(key) {
  if (!key) return '';
  return key.length <= 10 ? '•'.repeat(key.length) : `${key.slice(0, 5)}…${key.slice(-4)}`;
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || '';
  }
}

export const PROFILES_PATH = PROFILES_FILE;
