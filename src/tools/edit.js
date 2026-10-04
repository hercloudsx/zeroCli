import fs from 'node:fs';
import { resolvePath, displayPath } from '../utils/paths.js';
import { readText, writeText } from './fileState.js';
import { makeDiff } from './diffUtil.js';

function applyEdit(content, input) {
  const { old_string: oldS, new_string: newS, replace_all: all } = input;
  if (oldS === newS) throw new Error('No changes to make: old_string and new_string are exactly the same.');
  const count = content.split(oldS).length - 1;
  if (count === 0) throw new Error(`String to replace not found in file.\nString: ${oldS}`);
  if (count > 1 && !all) {
    throw new Error(
      `Found ${count} matches of the string to replace, but replace_all is false. ` +
        'To replace all occurrences, set replace_all to true. To replace only one occurrence, provide more context to uniquely identify the instance.',
    );
  }
  return all ? content.split(oldS).join(newS) : content.replace(oldS, () => newS);
}

function nextContent(file, input) {
  const exists = fs.existsSync(file);
  const old = exists ? readText(file).content : '';
  if (input.old_string === '' && !old) return { old, next: input.new_string };
  return { old, next: applyEdit(old, input) };
}

export const EditTool = {
  name: 'Edit',
  description: 'Performs exact string replacements in files.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      old_string: { type: 'string', description: 'The text to replace' },
      new_string: { type: 'string', description: 'The text to replace it with' },
      replace_all: { type: 'boolean', default: false },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  isEdit: true,
  userFacingName: () => 'Update',
  renderInput: (input, ctx) => displayPath(resolvePath(input.file_path, ctx.cwd), ctx.cwd),
  validate(input, ctx) {
    const file = resolvePath(input.file_path, ctx.cwd);
    const exists = fs.existsSync(file);
    if (!exists && input.old_string !== '') return `File does not exist: ${displayPath(file, ctx.cwd)}`;
    if (exists && !ctx.readFiles.has(file)) return 'File has not been read yet. Read it first before writing to it.';
    try {
      nextContent(file, input);
    } catch (e) {
      return e.message;
    }
    return null;
  },
  preview(input, ctx) {
    const { old, next } = nextContent(resolvePath(input.file_path, ctx.cwd), input);
    return { kind: 'diff', ...makeDiff(old, next) };
  },
  async call(input, ctx) {
    const file = resolvePath(input.file_path, ctx.cwd);
    const shown = displayPath(file, ctx.cwd);
    const crlf = fs.existsSync(file) && readText(file).crlf;
    const { old, next } = nextContent(file, input);
    writeText(file, next, crlf);
    ctx.readFiles.set(file, fs.statSync(file).mtimeMs);
    const diff = makeDiff(old, next);
    ctx.stats.linesAdded += diff.additions;
    ctx.stats.linesRemoved += diff.removals;
    return {
      output: `The file ${file} has been updated successfully.`,
      display: { kind: 'diff', text: { key: 'tool.updated', file: shown, additions: diff.additions, removals: diff.removals }, ...diff },
    };
  },
};
