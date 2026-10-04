import fs from 'node:fs';
import path from 'node:path';
import { ZERO_HOME } from './config.js';
import { applyTheme } from '../theme.js';
import { setMascotColors, HAIR_COLORS, EYE_COLORS } from '../mascot.js';

const SETTINGS_FILE = path.join(ZERO_HOME, 'settings.json');

/**
 * Every user-facing setting. `type` drives how /settings edits it:
 *   bool  -> toggle      enum -> cycle options      number -> step within [min, max]      text -> inline edit
 */
export const SETTINGS_SCHEMA = [
  { section: 'Appearance' },
  { key: 'language', label: 'Language / Язык', type: 'enum', options: ['en', 'ru'], default: 'en' },
  { key: 'theme', label: 'Theme', type: 'enum', options: ['dark', 'light'], default: 'dark' },
  { key: 'verbose', label: 'Verbose output', type: 'bool', default: false, description: 'Expand tool output (same as ctrl+o)' },
  { key: 'showTips', label: 'Show tips under the spinner', type: 'bool', default: true },
  { key: 'displayName', label: 'Display name', type: 'text', default: '', description: 'Used in the welcome banner (blank = OS username)' },

  { section: 'Zero-chan' },
  { key: 'showBuddy', label: 'Show Zero-chan next to the prompt', type: 'bool', default: true },
  { key: 'buddySpeech', label: 'Speech bubbles', type: 'bool', default: true },
  { key: 'hairColor', label: 'Hair color', type: 'enum', options: Object.keys(HAIR_COLORS), default: 'coral' },
  { key: 'eyeColor', label: 'Eye color', type: 'enum', options: Object.keys(EYE_COLORS), default: 'violet' },

  { section: 'Permissions' },
  {
    key: 'permissionMode',
    label: 'Default permission mode',
    type: 'enum',
    options: ['default', 'acceptEdits', 'plan', 'fullAuto'],
    default: 'default',
    description: 'Mode new sessions start in (also applied now)',
  },

  { section: 'Full auto' },
  { key: 'fullAutoMaxSteps', label: 'Max autonomous turns', type: 'number', min: 1, max: 100, step: 1, default: 10, description: 'How many times Zero-chan keeps going on her own' },
  { key: 'fullAutoSafety', label: 'Block destructive commands', type: 'bool', default: true, description: 'rm -rf /, format, force-push, … stay blocked' },
  { key: 'fullAutoContinue', label: 'Auto-continue unfinished todos', type: 'bool', default: true },

  { section: 'Tools' },
  { key: 'shell', label: 'Shell', type: 'enum', options: ['auto', 'bash', 'powershell'], default: 'auto' },
  { key: 'bashTimeout', label: 'Bash timeout (seconds)', type: 'number', min: 10, max: 600, step: 10, default: 120 },

  { section: 'Model' },
  // Providers, models and API keys live in provider profiles (/profiles).
  { key: 'mockSpeed', label: 'Mock model speed', type: 'enum', options: ['slow', 'normal', 'fast', 'instant'], default: 'normal' },

  { section: 'Notifications' },
  { key: 'bell', label: 'Terminal bell when a turn finishes', type: 'bool', default: false },
];

export const SETTING_DEFS = SETTINGS_SCHEMA.filter((s) => s.key);
export const DEFAULTS = Object.fromEntries(SETTING_DEFS.map((s) => [s.key, s.default]));

function sanitize(def, value) {
  if (value === undefined || value === null) return def.default;
  switch (def.type) {
    case 'bool':
      return typeof value === 'boolean' ? value : value === 'true' || value === 'on' || value === '1';
    case 'enum':
      return def.options.includes(value) ? value : def.default;
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? Math.min(def.max, Math.max(def.min, Math.round(n))) : def.default;
    }
    default:
      return String(value);
  }
}

function load() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {}
  return Object.fromEntries(SETTING_DEFS.map((d) => [d.key, sanitize(d, raw[d.key])]));
}

/** The live settings object. Read it anywhere; change it through setSetting(). */
export const settings = load();
const listeners = new Set();

function applySideEffects() {
  applyTheme(settings.theme);
  setMascotColors({ hair: settings.hairColor, eyes: settings.eyeColor });
}
applySideEffects();

export function save() {
  try {
    fs.mkdirSync(ZERO_HOME, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch {}
}

/** Update one setting (validated), persist, apply, and notify subscribers. Returns the stored value. */
export function setSetting(key, value) {
  const def = SETTING_DEFS.find((d) => d.key === key);
  if (!def) throw new Error(`Unknown setting: ${key}`);
  settings[key] = sanitize(def, value);
  applySideEffects();
  save();
  for (const fn of listeners) fn(key, settings[key]);
  return settings[key];
}

export function resetSettings() {
  for (const d of SETTING_DEFS) settings[d.key] = d.default;
  applySideEffects();
  save();
  for (const fn of listeners) fn(null, null);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Raw (untranslated) value, used by `/settings list` and as the stored form. */
export function formatValue(def, value) {
  if (def.type === 'secret') return value ? `${value.slice(0, 5)}…${value.slice(-4)}` : '(not set)';
  if (def.type === 'bool') return value ? 'true' : 'false';
  if (def.type === 'text') return value === '' ? '(not set)' : value;
  return String(value);
}

export const SETTINGS_PATH = SETTINGS_FILE;
