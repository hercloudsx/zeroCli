import { settings } from '../utils/settings.js';
import { t } from '../i18n.js';

export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'fullAuto', 'bypassPermissions'];

// Commands full auto mode still refuses, even though it approves everything else.
const DESTRUCTIVE = [
  [/\brm\s+(-\w+\s+)*-\w*(rf|fr)\w*\s+(--no-preserve-root\s+)?(\/|~|\*|\.\.?|[A-Za-z]:[\\/]?)(\s|$)/, 'guard.rootDelete'],
  [/\bmkfs(\.\w+)?\b|\bformat(\.com)?\s+[A-Za-z]:/i, 'guard.format'],
  [/\bdd\s+.*\bof=\/dev\//, 'guard.dd'],
  [/(^|[;&|]\s*|sudo\s+)(shutdown|reboot|halt|poweroff)(\s|$)|Stop-Computer|Restart-Computer/i, 'guard.shutdown'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'guard.forkBomb'],
  [/\bgit\s+push\b.*(--force\b|\s-f\b)/, 'guard.forcePush'],
  [/\bgit\s+(reset\s+--hard|clean\s+-\w*f)/, 'guard.resetHard'],
  [/\b(del|erase)\s+.*\/[sq]\b|\brd\s+\/s|\brmdir\s+\/s/i, 'guard.winDelete'],
  [/Remove-Item\b.*-Recurse/i, 'guard.psDelete'],
  [/\bchmod\s+-R\s+\d+\s+\//, 'guard.chmod'],
  [/\b(curl|wget|iwr|Invoke-WebRequest)\b[^|]*\|\s*((ba|z)?sh|iex)\b/i, 'guard.pipeShell'],
  [/>\s*\/dev\/sd[a-z]/, 'guard.diskWrite'],
];

export function destructiveReason(command) {
  for (const [re, why] of DESTRUCTIVE) if (re.test(command)) return t(why);
  return null;
}

// Read-only commands that never need approval (only when not chained / redirected).
const SAFE_COMMANDS = [
  'ls', 'pwd', 'echo', 'whoami', 'date', 'which', 'where', 'cat', 'head', 'tail', 'wc', 'tree', 'dir',
  'git status', 'git diff', 'git log', 'git branch', 'git show', 'git remote',
  'node --version', 'node -v', 'npm --version', 'npm -v', 'npm ls', 'python --version',
];

const isChained = (cmd) => /[;&|`<>]|\$\(/.test(cmd);

function isSafeBash(cmd) {
  const c = cmd.trim();
  if (isChained(c)) return false;
  return SAFE_COMMANDS.some((s) => c === s || c.startsWith(s + ' '));
}

/** "npm run test" -> "npm run", "git commit -m x" -> "git commit", "ls -la" -> "ls" */
export function commandPrefix(cmd) {
  const words = cmd.trim().split(/\s+/);
  const multi = ['git', 'npm', 'npx', 'yarn', 'pnpm', 'cargo', 'go', 'docker', 'kubectl', 'pip', 'python', 'node'];
  if (multi.includes(words[0]) && words[1] && !words[1].startsWith('-')) {
    if (['npm', 'yarn', 'pnpm'].includes(words[0]) && words[1] === 'run' && words[2]) return words.slice(0, 3).join(' ');
    return words.slice(0, 2).join(' ');
  }
  return words[0];
}

function matchesRule(rule, tool, input) {
  const m = /^(\w+)(?:\((.*)\))?$/.exec(rule);
  if (!m || m[1] !== tool.name) return false;
  const spec = m[2];
  if (spec === undefined) return true;
  if (tool.name === 'Bash') {
    if (isChained(input.command)) return false;
    if (spec.endsWith(':*')) {
      const prefix = spec.slice(0, -2);
      return input.command === prefix || input.command.startsWith(prefix + ' ');
    }
    return input.command === spec;
  }
  if (tool.name === 'WebFetch' && spec.startsWith('domain:')) return tool.domain(input) === spec.slice(7);
  return false;
}

/**
 * Decide whether a tool call may run.
 * @returns {{behavior: 'allow'|'ask'|'deny', message?: string}}
 */
export function checkPermission(tool, input, session) {
  if (tool.isReadOnly) return { behavior: 'allow' };
  if (session.permissionMode === 'bypassPermissions') return { behavior: 'allow' };
  if (session.permissionMode === 'fullAuto') {
    const why = tool.name === 'Bash' && settings.fullAutoSafety ? destructiveReason(input.command) : null;
    if (why) {
      return {
        behavior: 'deny',
        message: t('perm.guardDenied', { why }),
      };
    }
    return { behavior: 'allow' };
  }
  if (session.permissionMode === 'plan') {
    return {
      behavior: 'deny',
      message: t('perm.planDenied'),
    };
  }
  if (tool.isEdit && session.permissionMode === 'acceptEdits') return { behavior: 'allow' };
  if (tool.name === 'Bash' && isSafeBash(input.command)) return { behavior: 'allow' };
  for (const rule of session.allowRules) if (matchesRule(rule, tool, input)) return { behavior: 'allow' };
  return { behavior: 'ask' };
}

/** The "Yes, and don't ask again …" option for a tool call. */
export function alwaysAllowOption(tool, input, cwd) {
  if (tool.isEdit) return { label: t('perm.always.edits'), hint: 'shift+tab', mode: 'acceptEdits' };
  if (tool.name === 'Bash') {
    const prefix = commandPrefix(input.command);
    return { label: t('perm.always.bash', { prefix, cwd }), rule: `Bash(${prefix}:*)` };
  }
  if (tool.name === 'WebFetch') {
    const d = tool.domain(input);
    return { label: t('perm.always.fetch', { domain: d }), rule: `WebFetch(domain:${d})` };
  }
  return { label: t('perm.always.tool', { tool: tool.name }), rule: tool.name };
}
