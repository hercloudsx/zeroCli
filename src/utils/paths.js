import os from 'node:os';
import path from 'node:path';

export function resolvePath(p, cwd) {
  if (!p) return cwd;
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(cwd, p);
}

/** Relative path when inside cwd, otherwise absolute. */
export function displayPath(p, cwd) {
  const rel = path.relative(cwd, p);
  if (!rel) return '.';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return p;
  return rel;
}

export function tildify(p) {
  const home = os.homedir();
  return p.toLowerCase().startsWith(home.toLowerCase()) ? '~' + p.slice(home.length) : p;
}

export const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'target', '.cache'];
export const IGNORE_GLOBS = IGNORE_DIRS.map((d) => `**/${d}/**`);
