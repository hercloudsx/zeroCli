import fg from 'fast-glob';
import path from 'node:path';
import { IGNORE_GLOBS } from './paths.js';

let cache = { cwd: null, files: [], at: 0 };

/** Project files (and directories) for @-mention completion, refreshed every 15s. */
export function getFileIndex(cwd) {
  if (cache.cwd === cwd && Date.now() - cache.at < 15_000) return cache.files;
  try {
    const entries = fg.sync('**/*', {
      cwd: cwd.replace(/\\/g, '/'),
      dot: true,
      onlyFiles: false,
      markDirectories: true,
      ignore: IGNORE_GLOBS,
      suppressErrors: true,
      deep: 6,
    });
    cache = { cwd, files: entries.slice(0, 5000), at: Date.now() };
  } catch {
    cache = { cwd, files: [], at: Date.now() };
  }
  return cache.files;
}

export function searchFiles(cwd, query, limit = 8) {
  const q = query.toLowerCase();
  const scored = [];
  for (const f of getFileIndex(cwd)) {
    const lower = f.toLowerCase();
    const base = path.posix.basename(f.replace(/\/$/, '')).toLowerCase();
    let score;
    if (!q) score = f.split('/').length * 10 + f.length / 100;
    else if (base.startsWith(q)) score = 0 + f.length / 100;
    else if (lower.startsWith(q)) score = 1 + f.length / 100;
    else if (base.includes(q)) score = 2 + f.length / 100;
    else if (lower.includes(q)) score = 3 + f.length / 100;
    else continue;
    scored.push({ f, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.f);
}
