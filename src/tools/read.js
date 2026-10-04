import fs from 'node:fs';
import { resolvePath, displayPath } from '../utils/paths.js';
import { isProbablyBinary } from './fileState.js';

const MAX_LINES = 2000;
const MAX_LINE_LEN = 2000;

export const ReadTool = {
  name: 'Read',
  description: 'Reads a file from the local filesystem. Returns lines in cat -n format.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path of the file to read' },
      offset: { type: 'number', description: 'Line number to start reading from (1-based)' },
      limit: { type: 'number', description: 'Number of lines to read' },
    },
    required: ['file_path'],
  },
  isReadOnly: true,
  userFacingName: () => 'Read',
  renderInput: (input, ctx) => displayPath(resolvePath(input.file_path, ctx.cwd), ctx.cwd),
  async call(input, ctx) {
    const file = resolvePath(input.file_path, ctx.cwd);
    if (!fs.existsSync(file)) throw new Error(`File does not exist: ${displayPath(file, ctx.cwd)}`);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) throw new Error(`EISDIR: ${displayPath(file, ctx.cwd)} is a directory. Use LS instead.`);
    const buf = fs.readFileSync(file);
    if (isProbablyBinary(buf)) throw new Error('Cannot read binary file.');
    const all = buf.toString('utf8').replace(/\r\n/g, '\n').split('\n');
    if (all.length && all[all.length - 1] === '') all.pop();
    const start = Math.max(1, input.offset ?? 1);
    const limit = input.limit ?? MAX_LINES;
    const slice = all.slice(start - 1, start - 1 + limit);
    ctx.readFiles.set(file, stat.mtimeMs);
    const output = slice.length
      ? slice
          .map((l, i) => `${String(start + i).padStart(6)}\t${l.length > MAX_LINE_LEN ? l.slice(0, MAX_LINE_LEN) + '…' : l}`)
          .join('\n')
      : '<system-reminder>The file exists but is empty.</system-reminder>';
    return {
      output,
      display: {
        kind: 'summary',
        text: { key: 'tool.readLines', n: slice.length },
        lines: slice,
        startLine: start,
      },
    };
  },
};
