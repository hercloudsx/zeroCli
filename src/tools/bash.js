import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { settings } from '../utils/settings.js';

const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;
const MAX_OUTPUT = 30_000;
const CWD_MARKER = '__ZERO_CWD__';

let cachedShell;
let cachedFor;

/** Pick a shell: Git Bash on Windows when available (like Claude Code), else PowerShell; $SHELL elsewhere. */
export function getShell() {
  const pref = settings.shell;
  if (cachedShell && cachedFor === pref) return cachedShell;
  cachedFor = pref;
  cachedShell = undefined;
  if (pref === 'powershell') return (cachedShell = { path: process.platform === 'win32' ? 'powershell.exe' : 'pwsh', kind: 'powershell' });
  if (process.env.ZERO_SHELL && fs.existsSync(process.env.ZERO_SHELL)) {
    const isPs = /powershell|pwsh/i.test(process.env.ZERO_SHELL);
    return (cachedShell = { path: process.env.ZERO_SHELL, kind: isPs ? 'powershell' : 'bash' });
  }
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
    ];
    try {
      const where = spawnSync('where', ['git'], { encoding: 'utf8' });
      const git = where.stdout?.split(/\r?\n/).find(Boolean);
      if (git) candidates.push(git.replace(/\\cmd\\git\.exe$/i, '\\bin\\bash.exe'));
    } catch {}
    const bash = candidates.find((c) => c && fs.existsSync(c));
    if (bash) return (cachedShell = { path: bash, kind: 'bash' });
    if (pref === 'bash') return (cachedShell = { path: 'bash.exe', kind: 'bash' });
    return (cachedShell = { path: 'powershell.exe', kind: 'powershell' });
  }
  return (cachedShell = { path: process.env.SHELL || '/bin/bash', kind: 'bash' });
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

/** Run a command, tracking `cd` so the working directory persists between calls. */
export function runShell(command, { cwd, signal, timeout = DEFAULT_TIMEOUT, onOutput } = {}) {
  const shell = getShell();
  let args;
  if (shell.kind === 'bash') {
    const script = `${command}\n__zero_ec=$?; printf '\\n${CWD_MARKER}%s\\n' "$(pwd -W 2>/dev/null || pwd)"; exit $__zero_ec`;
    args = ['-c', script];
  } else {
    const script = `${command}; $__ec = $LASTEXITCODE; Write-Output "\`n${CWD_MARKER}$((Get-Location).Path)"; exit $__ec`;
    args = ['-NoProfile', '-NonInteractive', '-Command', script];
  }

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(shell.path, args, {
      cwd,
      env: { ...process.env, TERM: 'dumb', NO_COLOR: '1', GIT_PAGER: 'cat', PAGER: 'cat' },
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let interrupted = false;
    let timedOut = false;
    const onAbort = () => { interrupted = true; killTree(child); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, Math.min(timeout, MAX_TIMEOUT));

    child.stdout.on('data', (d) => { stdout += d.toString(); onOutput?.(stdout, stderr); });
    child.stderr.on('data', (d) => { stderr += d.toString(); onOutput?.(stdout, stderr); });
    const finish = (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      let newCwd;
      const idx = stdout.lastIndexOf(`\n${CWD_MARKER}`);
      if (idx !== -1) {
        newCwd = stdout.slice(idx + CWD_MARKER.length + 1).trim();
        stdout = stdout.slice(0, idx);
      }
      if (newCwd && shell.kind === 'bash' && process.platform === 'win32') newCwd = newCwd.replace(/\//g, '\\');
      resolve({
        stdout: stdout.replace(/\r\n/g, '\n').replace(/\n+$/, ''),
        stderr: stderr.replace(/\r\n/g, '\n').replace(/\n+$/, ''),
        code: code ?? (interrupted || timedOut ? 130 : 1),
        interrupted,
        timedOut,
        cwd: newCwd && fs.existsSync(newCwd) ? newCwd : undefined,
        durationMs: Date.now() - started,
      });
    };
    child.on('error', (err) => { stderr += err.message; finish(1); });
    child.on('close', finish);
  });
}

const truncate = (s) => (s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n\n... [${s.length - MAX_OUTPUT} characters truncated]` : s);

export const BashTool = {
  name: 'Bash',
  description: 'Executes a shell command in a persistent working directory, with optional timeout.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute' },
      timeout: { type: 'number', description: 'Optional timeout in milliseconds (max 600000)' },
      description: { type: 'string', description: 'Clear, concise description of what this command does in 5-10 words' },
    },
    required: ['command'],
  },
  userFacingName: () => 'Bash',
  renderInput: (input) => input.command,
  async call(input, ctx) {
    const res = await runShell(input.command, { cwd: ctx.cwd, signal: ctx.signal, timeout: input.timeout ?? ctx.defaultTimeout });
    if (res.cwd && res.cwd !== ctx.cwd) ctx.setCwd(res.cwd);
    if (res.interrupted) {
      const e = new Error('Command was interrupted');
      e.interrupted = true;
      throw e;
    }
    let output = [res.stdout, res.stderr].filter(Boolean).join('\n');
    if (res.timedOut) output += `\nCommand timed out after ${Math.round(res.durationMs / 1000)}s`;
    if (res.code !== 0 && !res.timedOut) output += `${output ? '\n' : ''}Exit code ${res.code}`;
    return {
      output: truncate(output || '(No content)'),
      isError: res.code !== 0,
      display: { kind: 'bash', stdout: res.stdout, stderr: res.stderr, code: res.code, timedOut: res.timedOut },
    };
  },
};
