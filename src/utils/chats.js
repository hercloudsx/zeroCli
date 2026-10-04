import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ZERO_HOME } from './config.js';

/**
 * Saved chats: one JSON file per chat in ~/.zero/chats/.
 * { id, name, cwd, createdAt, updatedAt, tokens, data: <Engine.serialize()> }
 */
export const CHATS_DIR = path.join(ZERO_HOME, 'chats');

export const newChatId = () => crypto.randomBytes(4).toString('hex');

const fileOf = (id) => path.join(CHATS_DIR, `${id.replace(/[^\w-]/g, '')}.json`);

const sameDir = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export function saveChat(chat) {
  fs.mkdirSync(CHATS_DIR, { recursive: true });
  const file = fileOf(chat.id);
  // Write to a temp file first so a crash never leaves a half-written chat.
  fs.writeFileSync(file + '.tmp', JSON.stringify(chat));
  fs.renameSync(file + '.tmp', file);
}

export function loadChat(id) {
  try {
    return JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));
  } catch {
    return null;
  }
}

export function deleteChat(id) {
  try {
    fs.unlinkSync(fileOf(id));
    return true;
  } catch {
    return false;
  }
}

/** Chats for a project directory, most recently used first (without their message data). */
export function listChats(cwd) {
  let files = [];
  try {
    files = fs.readdirSync(CHATS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const chats = [];
  for (const f of files) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(CHATS_DIR, f), 'utf8'));
      if (cwd && !sameDir(c.cwd, cwd)) continue;
      chats.push({
        id: c.id,
        name: c.name,
        cwd: c.cwd,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        tokens: c.tokens ?? 0,
        messages: c.data?.messages?.length ?? 0,
      });
    } catch {}
  }
  return chats.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A short chat title from the first real prompt. */
export function titleFrom(messages) {
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const b = m.content.find((x) => x.type === 'text');
    if (!b) continue;
    const text = b.text.trim();
    if (!text || text.startsWith('[') || text.startsWith('<bash-')) continue;
    if (text.startsWith('<zero-command')) return '/init';
    const line = text.split('\n')[0];
    return line.length > 48 ? line.slice(0, 47) + '…' : line;
  }
  return null;
}

/** Rebuild transcript items (what the UI renders) from a saved conversation. */
export function transcriptFrom(messages, displays = {}, cwd) {
  const items = [];
  let n = 0;
  const id = (p) => `${p}_restored_${n++}`;
  for (const m of messages) {
    for (const b of m.content) {
      if (m.role === 'assistant') {
        if (b.type === 'text' && b.text.trim()) items.push({ type: 'assistant', id: id('msg'), text: b.text, done: true });
        if (b.type === 'tool_use') {
          const d = displays[b.id] ?? { status: 'done' };
          if (d.silent) continue;
          items.push({ type: 'tool', id: b.id, name: b.name, input: b.input, status: d.status ?? 'done', display: d.display, error: d.error, ctx: { cwd } });
        }
        continue;
      }
      if (b.type !== 'text') continue; // tool results are already reflected in the tool items
      const text = b.text;
      if (text.startsWith('[Request interrupted')) continue;
      if (text.startsWith('[compact]')) {
        items.push({ type: 'notice', id: id('compact'), text: '✻ ' + text.slice(10, 120) + '…' });
        continue;
      }
      const bash = /^<bash-input>([\s\S]*?)<\/bash-input>\n<bash-stdout>([\s\S]*?)<\/bash-stdout><bash-stderr>([\s\S]*?)<\/bash-stderr>$/.exec(text);
      if (bash) {
        items.push({ type: 'bash', id: id('bash'), command: bash[1], running: false, display: { stdout: bash[2], stderr: bash[3] } });
        continue;
      }
      items.push({ type: 'user', id: id('user'), text: text.startsWith('<zero-command') ? '/init' : text });
    }
  }
  return items;
}
