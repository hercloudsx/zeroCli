import fs from 'node:fs';

/** Read a text file, normalising CRLF so edits match; remembers the original line ending. */
export function readText(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const crlf = raw.includes('\r\n');
  return { content: crlf ? raw.replace(/\r\n/g, '\n') : raw, crlf };
}

export function writeText(file, content, crlf) {
  fs.writeFileSync(file, crlf ? content.replace(/\r?\n/g, '\r\n') : content, 'utf8');
}

export function isProbablyBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function countLines(s) {
  if (!s) return 0;
  return s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
}
