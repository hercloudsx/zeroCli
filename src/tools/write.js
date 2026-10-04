import fs from 'node:fs';
import path from 'node:path';
import { resolvePath, displayPath } from '../utils/paths.js';
import { readText, writeText, countLines } from './fileState.js';
import { makeDiff } from './diffUtil.js';

export const WriteTool = {
  name: 'Write',
  description: 'Writes a file to the local filesystem, overwriting it if it exists.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path of the file to write' },
      content: { type: 'string', description: 'The content to write' },
    },
    required: ['file_path', 'content'],
  },
  isEdit: true,
  userFacingName: () => 'Write',
  renderInput: (input, ctx) => displayPath(resolvePath(input.file_path, ctx.cwd), ctx.cwd),
  validate(input, ctx) {
    const file = resolvePath(input.file_path, ctx.cwd);
    if (fs.existsSync(file) && !ctx.readFiles.has(file)) {
      return 'File has not been read yet. Read it first before writing to it.';
    }
    return null;
  },
  /** Preview shown in the permission dialog. */
  preview(input, ctx) {
    const file = resolvePath(input.file_path, ctx.cwd);
    if (fs.existsSync(file)) return { kind: 'diff', ...makeDiff(readText(file).content, input.content) };
    return { kind: 'create', lines: input.content.split('\n') };
  },
  async call(input, ctx) {
    const file = resolvePath(input.file_path, ctx.cwd);
    const shown = displayPath(file, ctx.cwd);
    const existed = fs.existsSync(file);
    let old = '';
    let crlf = false;
    if (existed) ({ content: old, crlf } = readText(file));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeText(file, input.content, crlf);
    ctx.readFiles.set(file, fs.statSync(file).mtimeMs);
    if (existed) {
      const diff = makeDiff(old, input.content);
      ctx.stats.linesAdded += diff.additions;
      ctx.stats.linesRemoved += diff.removals;
      return {
        output: `The file ${file} has been updated.`,
        display: { kind: 'diff', text: { key: 'tool.updated', file: shown, additions: diff.additions, removals: diff.removals }, ...diff },
      };
    }
    const n = countLines(input.content);
    ctx.stats.linesAdded += n;
    return {
      output: `File created successfully at: ${file}`,
      display: { kind: 'create', text: { key: 'tool.wroteLines', n, file: shown }, lines: input.content.split('\n') },
    };
  },
};
