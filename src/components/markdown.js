import chalk from 'chalk';
import { theme } from '../theme.js';

const KEYWORDS = new Set(
  ('const let var function return if else for while do switch case break continue new class extends import export from default ' +
    'async await try catch finally throw typeof instanceof in of this super null undefined true false void yield static get set ' +
    'def elif lambda pass None True False and or not is with as raise except self fn pub mut impl struct enum match use mod ' +
    'func go defer package type interface map chan public private protected int string bool echo then fi done esac').split(' '),
);

const TOKEN = /(\/\/.*$|#(?!!).*$|\/\*.*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;

/** Tiny syntax highlighter, good enough for code blocks in a terminal. */
export function highlight(line, lang = '') {
  const hashComments = /^(py|python|sh|bash|shell|zsh|rb|ruby|yaml|yml|toml|ps1|powershell)$/i.test(lang);
  return line.replace(TOKEN, (tok) => {
    if (tok.startsWith('//') || tok.startsWith('/*')) return chalk.hex('#6A9955')(tok);
    if (tok.startsWith('#')) return hashComments ? chalk.hex('#6A9955')(tok) : tok;
    if (/^["'`]/.test(tok)) return chalk.hex('#CE9178')(tok);
    if (/^\d/.test(tok)) return chalk.hex('#B5CEA8')(tok);
    if (KEYWORDS.has(tok)) return chalk.hex('#C586C0')(tok);
    if (/^[A-Z]/.test(tok)) return chalk.hex('#4EC9B0')(tok);
    return tok;
  });
}

/** Inline markdown: `code`, **bold**, *italic*, ~~strike~~, [links](url). */
export function renderInline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(chalk.hex(theme.permission)(c));
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s
    .replace(/\*\*([^*]+)\*\*/g, (_, t) => chalk.bold(t))
    .replace(/__([^_]+)__/g, (_, t) => chalk.bold(t))
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, (_, p, t) => p + chalk.italic(t))
    .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, (_, p, t) => p + chalk.italic(t))
    .replace(/~~([^~]+)~~/g, (_, t) => chalk.strikethrough(t))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `${t} (${chalk.hex(theme.permission).underline(u)})`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

/** Render a markdown string to an ANSI string. */
export function renderMarkdown(text) {
  const out = [];
  let inCode = false;
  let lang = '';
  for (const line of text.split('\n')) {
    const fence = /^\s*```\s*([\w+-]*)/.exec(line);
    if (fence) {
      inCode = !inCode;
      lang = inCode ? fence[1] : '';
      continue;
    }
    if (inCode) {
      out.push(highlight(line, lang));
      continue;
    }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      out.push(m[1].length === 1 ? chalk.bold.italic.underline(renderInline(m[2])) : chalk.bold(renderInline(m[2])));
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(chalk.dim('─'.repeat(40)));
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      out.push(chalk.dim.italic('▎ ' + renderInline(m[1])));
    } else if ((m = /^(\s*)[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line))) {
      const box = m[2] === undefined ? '' : m[2] === ' ' ? '☐ ' : '☒ ';
      out.push(`${m[1]}- ${box}${renderInline(m[3])}`);
    } else if ((m = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line))) {
      out.push(`${m[1]}${m[2]}. ${renderInline(m[3])}`);
    } else {
      out.push(renderInline(line));
    }
  }
  // collapse runs of blank lines
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}
