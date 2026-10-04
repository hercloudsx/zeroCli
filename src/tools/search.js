import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { resolvePath, displayPath, IGNORE_GLOBS, IGNORE_DIRS } from '../utils/paths.js';
import { isProbablyBinary } from './fileState.js';

const toPosix = (p) => p.replace(/\\/g, '/');

export const GlobTool = {
  name: 'Glob',
  description: 'Fast file pattern matching. Returns matching paths sorted by modification time.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.js"' },
      path: { type: 'string', description: 'Directory to search in' },
    },
    required: ['pattern'],
  },
  isReadOnly: true,
  userFacingName: () => 'Search',
  renderInput: (input, ctx) =>
    `pattern: "${input.pattern}"` + (input.path ? `, path: "${displayPath(resolvePath(input.path, ctx.cwd), ctx.cwd)}"` : ''),
  async call(input, ctx) {
    const base = resolvePath(input.path, ctx.cwd);
    const entries = await fg(input.pattern, {
      cwd: toPosix(base),
      dot: true,
      absolute: true,
      stats: true,
      onlyFiles: true,
      ignore: IGNORE_GLOBS,
      suppressErrors: true,
    });
    entries.sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));
    const files = entries.slice(0, 100).map((e) => path.normalize(e.path));
    const truncated = entries.length > 100;
    return {
      output: files.length
        ? files.join('\n') + (truncated ? '\n(Results are truncated. Consider using a more specific path or pattern.)' : '')
        : 'No files found',
      display: { kind: 'summary', text: { key: 'tool.foundFiles', n: entries.length }, lines: files.map((f) => displayPath(f, ctx.cwd)) },
      data: { files },
    };
  },
};

export const GrepTool = {
  name: 'Grep',
  description: 'Searches file contents with a regular expression.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression to search for' },
      path: { type: 'string', description: 'File or directory to search in' },
      glob: { type: 'string', description: 'Glob to filter files, e.g. "*.js"' },
      output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'] },
      '-i': { type: 'boolean', description: 'Case insensitive' },
      head_limit: { type: 'number' },
    },
    required: ['pattern'],
  },
  isReadOnly: true,
  userFacingName: () => 'Search',
  renderInput: (input, ctx) =>
    `pattern: "${input.pattern}"` + (input.path ? `, path: "${displayPath(resolvePath(input.path, ctx.cwd), ctx.cwd)}"` : ''),
  async call(input, ctx) {
    const base = resolvePath(input.path, ctx.cwd);
    let re;
    try {
      re = new RegExp(input.pattern, input['-i'] ? 'i' : '');
    } catch (e) {
      throw new Error(`Invalid regex: ${e.message}`);
    }
    const mode = input.output_mode || 'files_with_matches';
    let files;
    if (fs.existsSync(base) && fs.statSync(base).isFile()) {
      files = [base];
    } else {
      const g = input.glob ? (input.glob.includes('/') ? input.glob : `**/${input.glob}`) : '**/*';
      files = await fg(g, { cwd: toPosix(base), dot: true, absolute: true, onlyFiles: true, ignore: IGNORE_GLOBS, suppressErrors: true });
      files = files.slice(0, 10_000).map((f) => path.normalize(f));
    }
    const limit = input.head_limit ?? 250;
    const matchedFiles = [];
    const contentLines = [];
    const counts = [];
    for (const file of files) {
      if (ctx.signal?.aborted) break;
      let buf;
      try {
        const st = fs.statSync(file);
        if (st.size > 2_000_000) continue;
        buf = fs.readFileSync(file);
      } catch {
        continue;
      }
      if (isProbablyBinary(buf)) continue;
      const lines = buf.toString('utf8').split(/\r?\n/);
      let n = 0;
      lines.forEach((line, i) => {
        if (re.test(line)) {
          n++;
          if (mode === 'content') contentLines.push(`${displayPath(file, ctx.cwd)}:${i + 1}:${line}`);
        }
      });
      if (n) {
        matchedFiles.push(file);
        counts.push(`${displayPath(file, ctx.cwd)}:${n}`);
      }
    }
    let out;
    let summary;
    if (mode === 'content') {
      out = contentLines.slice(0, limit);
      summary = { key: 'tool.foundLines', n: contentLines.length };
    } else if (mode === 'count') {
      out = counts.slice(0, limit);
      summary = { key: 'tool.foundFiles', n: matchedFiles.length };
    } else {
      out = matchedFiles.slice(0, limit);
      summary = { key: 'tool.foundFiles', n: matchedFiles.length };
    }
    return {
      output: out.length ? out.join('\n') : 'No matches found',
      display: { kind: 'summary', text: summary, lines: out.map((l) => (mode === 'files_with_matches' ? displayPath(l, ctx.cwd) : l)) },
      data: { files: matchedFiles, lines: contentLines },
    };
  },
};

export const LSTool = {
  name: 'LS',
  description: 'Lists files and directories in a given path as a tree.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Directory to list' } },
    required: [],
  },
  isReadOnly: true,
  userFacingName: () => 'List',
  renderInput: (input, ctx) => displayPath(resolvePath(input.path, ctx.cwd), ctx.cwd),
  async call(input, ctx) {
    const root = resolvePath(input.path, ctx.cwd);
    if (!fs.existsSync(root)) throw new Error(`Directory does not exist: ${displayPath(root, ctx.cwd)}`);
    if (!fs.statSync(root).isDirectory()) throw new Error(`Not a directory: ${displayPath(root, ctx.cwd)}`);
    const MAX = 500;
    let count = 0;
    const lines = [`- ${root}${path.sep}`];
    const entriesTop = [];
    const walk = (dir, depth) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
      for (const e of entries) {
        if (count >= MAX) return;
        if (IGNORE_DIRS.includes(e.name)) continue;
        count++;
        const isDir = e.isDirectory();
        lines.push(`${'  '.repeat(depth)}- ${e.name}${isDir ? '/' : ''}`);
        if (depth === 1) entriesTop.push({ name: e.name, dir: isDir });
        if (isDir && depth < 3) walk(path.join(dir, e.name), depth + 1);
      }
    };
    walk(root, 1);
    if (count >= MAX) lines.push(`\nThere are more than ${MAX} files in the directory. Use more specific paths to explore nested directories.`);
    return {
      output: lines.join('\n'),
      display: { kind: 'summary', text: { key: 'tool.listedPaths', n: count }, lines: lines.slice(1) },
      data: { top: entriesTop },
    };
  },
};
