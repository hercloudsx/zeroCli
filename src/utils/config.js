import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ZERO_HOME = path.join(os.homedir(), '.zero');
const HISTORY_FILE = path.join(ZERO_HOME, 'history.json');
const MAX_HISTORY = 200;

function ensureHome() {
  try { fs.mkdirSync(ZERO_HOME, { recursive: true }); } catch {}
}

/** History entries: { text, cwd, time } newest last. */
export function loadHistory() {
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function appendHistory(text, cwd) {
  ensureHome();
  const history = loadHistory().filter((h) => !(h.text === text && h.cwd === cwd));
  history.push({ text, cwd, time: Date.now() });
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-MAX_HISTORY), null, 2)); } catch {}
}

export function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export const MEMORY_FILE = 'ZERO.md';
