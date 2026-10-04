#!/usr/bin/env node
import { render } from 'ink';
import chalk from 'chalk';
import { html } from '../src/components/h.js';
import { App } from '../src/App.js';
import { Engine, AbortError } from '../src/agent/engine.js';
import { PERMISSION_MODES } from '../src/agent/permissions.js';
import { createProvider } from '../src/providers/index.js';
import { activeProfile, findProfile, getProfiles, setActiveProfile } from '../src/utils/profiles.js';
import { theme, APP_NAME, VERSION, MASCOT_NAME } from '../src/theme.js';
import { settings } from '../src/utils/settings.js';
import { t } from '../src/i18n.js';

const HELP = `Usage: zero [options] [prompt]

${APP_NAME} - starts an interactive session by default, use -p/--print for non-interactive output

Arguments:
  prompt                              Your prompt

Options:
  -p, --print                         Print response and exit (useful for pipes)
  --permission-mode <mode>            Permission mode for the session (${PERMISSION_MODES.join(', ')})
  --full-auto                         Start in full auto mode (no prompts, auto-continue)
  --profile <name|n>                  Use this provider profile for this run only
  --dangerously-skip-permissions      Bypass all permission checks
  -v, --version                       Output the version number
  -h, --help                          Display help for command
`;

function parseArgs(argv) {
  const opts = { print: false, permissionMode: undefined, skip: false, prompt: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-p' || a === '--print') opts.print = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-v' || a === '--version') opts.version = true;
    else if (a === '--dangerously-skip-permissions') opts.skip = true;
    else if (a === '--full-auto') opts.permissionMode = 'fullAuto';
    else if (a === '--permission-mode') opts.permissionMode = argv[++i];
    else if (a.startsWith('--permission-mode=')) opts.permissionMode = a.split('=')[1];
    else if (a === '--profile') opts.profile = argv[++i] ?? '';
    else if (a.startsWith('--profile=')) opts.profile = a.slice('--profile='.length);
    else opts.prompt.push(a);
  }
  if (opts.permissionMode !== undefined && !PERMISSION_MODES.includes(opts.permissionMode)) {
    console.error(`Invalid permission mode: ${opts.permissionMode}. Use one of: ${PERMISSION_MODES.join(', ')}`);
    process.exit(1);
  }
  if (opts.skip) opts.permissionMode = 'bypassPermissions';
  if (opts.profile !== undefined) {
    const p = findProfile(opts.profile);
    if (!p) {
      console.error(`Unknown profile: ${opts.profile}. Profiles: ${getProfiles().map((x) => x.name).join(', ')}`);
      process.exit(1);
    }
    // Only for this run; the saved default profile stays as it is.
    setActiveProfile(p.id, { persist: false });
  }
  return opts;
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

/** -p mode: run one turn headlessly and print the assistant's text. */
async function printMode(opts) {
  const piped = await readStdin();
  const prompt = [opts.prompt.join(' '), piped.trim()].filter(Boolean).join('\n\n');
  if (!prompt) {
    console.error('Error: Input must be provided either through stdin or as a prompt argument when using --print');
    process.exit(1);
  }
  const engine = new Engine({ cwd: process.cwd(), provider: createProvider(activeProfile()), permissionMode: opts.permissionMode ?? settings.permissionMode });
  const texts = [];
  const ac = new AbortController();
  process.on('SIGINT', () => ac.abort());
  try {
    await engine.runTurn(
      prompt,
      {
        onText: (id, text, done) => done && texts.push(text),
        onToolStart: () => {},
        onToolEnd: () => {},
        requestPermission: async (req) => {
          texts.push(`(${req.tool.name} needs permission — rerun with --dangerously-skip-permissions or --permission-mode acceptEdits)`);
          return 'no';
        },
      },
      ac.signal,
    );
  } catch (e) {
    if (!(e instanceof AbortError)) {
      console.error(e.message);
      process.exit(1);
    }
  }
  process.stdout.write(texts.join('\n\n') + '\n');
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  process.stdout.write(HELP);
} else if (opts.version) {
  console.log(`${VERSION} (${APP_NAME})`);
} else if (opts.print) {
  await printMode(opts);
} else {
  if (!process.stdin.isTTY) {
    console.error('Error: interactive mode needs a TTY. Use -p for piped input.');
    process.exit(1);
  }
  const instance = render(
    html`<${App} permissionMode=${opts.permissionMode} allowBypass=${opts.skip} initialPrompt=${opts.prompt.join(' ') || undefined} />`,
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
  process.stdout.write(chalk.hex(theme.brand)('✻ ') + chalk.dim(`${t('common.bye')}  — ${MASCOT_NAME}`) + '\n');
  process.exit(0);
}
