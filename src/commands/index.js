import fs from 'node:fs';
import path from 'node:path';
import { Box, Text } from 'ink';
import { html } from '../components/h.js';
import { TodoList } from '../components/Messages.js';
import { settingLabel, displayValue } from '../components/SettingsPanel.js';
import { theme, APP_NAME, VERSION, MASCOT_NAME } from '../theme.js';
import { renderSprite } from '../mascot.js';
import { TOOLS } from '../tools/index.js';
import { getShell } from '../tools/bash.js';
import { createProvider } from '../providers/index.js';
import {
  activeProfile,
  getProfiles,
  findProfile,
  setActiveProfile,
  removeProfile,
  updateActiveModel,
  maskKey,
  hostOf,
  PROFILES_PATH,
  reloadProfiles,
} from '../utils/profiles.js';
import { tildify } from '../utils/paths.js';

/** "Claude · anthropic · claude-opus-5-5 · api.anthropic.com · key sk-an…12ab" */
export function profileLine(p) {
  if (p.type === 'mock') return `${p.name} · ${t('profiles.offline')}`;
  const key = p.apiKey ? `${t('profiles.key')} ${maskKey(p.apiKey)}` : t('profiles.noKey');
  return [p.name, p.type, p.model || '—', hostOf(p.baseUrl) || '—', key].join(' · ');
}
import { MEMORY_FILE, ZERO_HOME } from '../utils/config.js';
import { analyzeProject } from './init.js';
import { settings, setSetting, resetSettings, SETTING_DEFS, formatValue } from '../utils/settings.js';
import { t, LANGUAGES, timeAgo, fmtTokens } from '../i18n.js';

const fmtDuration = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

const kv = (rows) => {
  const w = Math.max(...rows.map(([k]) => k.length)) + 2;
  return rows.map(([k, v]) => `${(k + ':').padEnd(w)}${v}`).join('\n');
};

// Settings whose change should repaint the transcript.
const REPAINT_KEYS = ['language', 'theme', 'hairColor', 'eyeColor', 'displayName'];

/** Build a command whose description is translated on every read. */
const cmd = (name, descKey, run, extra = {}) => ({
  name,
  get description() {
    return t(descKey, { file: MEMORY_FILE, name: MASCOT_NAME });
  },
  run,
  ...extra,
});

export const COMMANDS = [
  cmd('help', 'cmd.help', (args, app) => {
    const cmds = COMMANDS.filter((c) => !c.hidden);
    const w = Math.max(...cmds.map((c) => c.name.length)) + 3;
    app.local(
      '/help',
      html`<${Box} flexDirection="column">
        <${Text} bold color=${theme.brand}>${APP_NAME} v${VERSION}</${Text}>
        <${Text}> </${Text}>
        <${Text}>${t('help.review', { name: MASCOT_NAME })}</${Text}>
        <${Text}> </${Text}>
        <${Text} bold>${t('help.usage')}</${Text}>
        <${Text}>• REPL: <${Text} bold>zero</${Text}> ${t('help.repl')}</${Text}>
        <${Text}>• ${t('help.nonInteractive')} <${Text} bold>zero -p "…"</${Text}></${Text}>
        <${Text}> </${Text}>
        <${Text} bold>${t('help.commands')}</${Text}>
        ${cmds.map((c) => html`<${Text} key=${c.name}>  <${Text} bold>${('/' + c.name).padEnd(w)}</${Text}><${Text} dimColor>${c.description}</${Text}></${Text}>`)}
        <${Text}> </${Text}>
        <${Text} dimColor>${t('help.shortcuts')}</${Text}>
      </${Box}>`,
    );
  }),

  cmd(
    'clear',
    'cmd.clear',
    // Like Claude Code: start fresh. The previous conversation stays saved under /chat.
    (args, app) => app.newChat(),
    { aliases: ['reset'] },
  ),

  cmd(
    'chat',
    'cmd.chat',
    (args, app) => {
      const [sub, ...rest] = (args || '').trim().split(/\s+/).filter(Boolean);
      const arg = rest.join(' ');
      const chats = app.chatList();
      // Resolve "3", an id, or a (partial) name to a chat.
      const find = (q) => {
        if (/^\d+$/.test(q) && chats[Number(q) - 1]) return chats[Number(q) - 1];
        const lq = q.toLowerCase();
        return chats.find((c) => c.id === q) ?? chats.find((c) => c.name.toLowerCase() === lq) ?? chats.find((c) => c.name.toLowerCase().includes(lq));
      };
      const input = `/chat ${args || ''}`.trim();

      if (!sub) return app.openChats();
      if (sub === 'list' || sub === 'ls') {
        if (!chats.length) return app.local(input, t('chat.none'));
        const w = Math.min(48, Math.max(...chats.map((c) => c.name.length))) + 2;
        return app.local(
          input,
          chats
            .map((c, i) =>
              `${c.current ? '●' : ' '} ${String(i + 1).padStart(2)}. ${c.name.padEnd(w)}${timeAgo(c.updatedAt)} · ${t('chat.messages', { n: c.messages })} · ${t('tokens.chat', { n: fmtTokens(c.tokens), raw: c.tokens })}`,
            )
            .join('\n'),
        );
      }
      if (sub === 'new') return app.newChat(arg || undefined);
      if (sub === 'rename') {
        if (!arg) return app.local(input, t('chat.usage'));
        app.renameChat(arg);
        return app.local(input, t('chat.renamed', { name: arg }));
      }
      if (sub === 'delete' || sub === 'rm') {
        const c = arg && find(arg);
        if (!c) return app.local(input, t('chat.notFound', { q: arg }));
        app.removeChat(c.id);
        return app.local(input, t('chat.deleted', { name: c.name }));
      }
      // "/chat switch 2", "/chat 2", "/chat my chat name"
      const q = sub === 'switch' || sub === 'open' || sub === 'resume' ? arg : [sub, ...rest].join(' ');
      const c = q && find(q);
      if (!c) return app.local(input, q ? t('chat.notFound', { q }) : t('chat.usage'));
      app.openChat(c.id);
    },
    { aliases: ['chats', 'resume'] },
  ),

  cmd('compact', 'cmd.compact', (args, app) => {
    const msgs = app.engine.messages;
    const prompts = msgs
      .filter((m) => m.role === 'user' && m.content.some((b) => b.type === 'text' && !b.text.startsWith('[') && !b.text.startsWith('<')))
      .map((m) => m.content.find((b) => b.type === 'text').text);
    const tools = msgs.flatMap((m) => m.content.filter((b) => b.type === 'tool_use').map((b) => b.name));
    // The summary is for the model, so it stays in English.
    const summary =
      `This session is being continued from a previous conversation that was compacted.\n` +
      `Summary: the user made ${prompts.length} request(s)` +
      (prompts.length ? ` (most recent: ${prompts.slice(-5).map((p) => JSON.stringify(p.slice(0, 80))).join(', ')})` : '') +
      `. ${tools.length} tool call(s) were made${tools.length ? ` (${[...new Set(tools)].join(', ')})` : ''}.` +
      (args ? `\nAdditional instructions: ${args}` : '');
    app.engine.messages = [
      { role: 'user', content: [{ type: 'text', text: `[compact] ${summary}` }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Understood.' }] },
    ];
    app.engine.displays = {};
    app.chatChanged();
    app.clearScreen([{ type: 'notice', id: `compact_${Date.now()}`, text: t('compact.done', { prompts: prompts.length, tools: tools.length }) }]);
  }),

  cmd('cost', 'cmd.cost', (args, app) => {
    const s = app.engine.stats;
    app.local(
      '/cost',
      kv([
        [t('cost.total'), t('cost.totalValue')],
        [t('cost.api'), fmtDuration(s.apiMs)],
        [t('cost.wall'), fmtDuration(Date.now() - s.startedAt)],
        [t('cost.changes'), t('cost.changesValue', { added: s.linesAdded, removed: s.linesRemoved })],
        [t('cost.usage'), t('cost.usageValue', { input: s.inputTokens.toLocaleString(), output: s.outputTokens.toLocaleString() })],
      ]),
    );
  }),

  cmd('status', 'cmd.status', (args, app) => {
    const e = app.engine;
    const shell = getShell();
    const mem = path.join(e.originalCwd, MEMORY_FILE);
    const done = e.todos.filter((x) => x.status === 'completed').length;
    app.local(
      '/status',
      kv([
        [t('status.version'), `${APP_NAME} ${VERSION}`],
        [t('status.model'), `${app.provider.label} (${app.provider.name}) · ${app.provider.description}`],
        [t('status.language'), LANGUAGES[settings.language]],
        [t('status.cwd'), e.cwd],
        [t('status.mode'), e.permissionMode],
        [t('status.rules'), e.allowRules.size ? [...e.allowRules].join(', ') : t('common.none')],
        [t('status.shell'), `${shell.path} (${shell.kind})`],
        [t('status.memory'), fs.existsSync(mem) ? mem : t('status.memoryNone')],
        [t('status.messages'), String(e.messages.length)],
        [t('status.todos'), e.todos.length ? t('status.todosValue', { done, total: e.todos.length }) : t('common.none')],
        [t('status.config'), ZERO_HOME],
      ]),
    );
  }),

  // /model           show the active profile's model (and the models its API offers)
  // /model <name>    change the model of the active profile
  cmd('model', 'cmd.model', async (args, app) => {
    const name = (args || '').trim();
    const profile = activeProfile();
    if (name) {
      if (profile.type === 'mock') return app.local(`/model ${name}`, t('model.mockProfile'));
      updateActiveModel(name);
      return app.local(`/model ${name}`, t('model.switched', { model: name, profile: profile.name }));
    }
    const lines = [t('model.current', { profile: profile.name, model: profile.model || t('common.notSet') })];
    if (profile.type !== 'mock') {
      try {
        const models = await createProvider(profile).listModels();
        if (models.length) lines.push('', ...models.slice(0, 60).map((m) => `${m === profile.model ? '✔' : ' '} ${m}`));
      } catch (e) {
        lines.push('', t('model.listFailed', { msg: e.message }));
      }
    }
    lines.push('', t('model.usageHint'));
    app.local(name ? `/model ${name}` : '/model', lines.join('\n'));
  }),

  // /profiles                 open the profile manager
  // /profiles list            list profiles
  // /profiles use <n|name>    switch the active profile
  // /profiles remove <n|name> delete a profile
  // (Keys are only ever entered in the manager's masked form, never as command arguments.)
  cmd(
    'profiles',
    'cmd.profiles',
    (args, app) => {
      const [sub, ...rest] = (args || '').trim().split(/\s+/).filter(Boolean);
      const arg = rest.join(' ');
      const input = `/profiles ${args || ''}`.trim();
      reloadProfiles();
      if (!sub) return app.openProfiles();
      if (sub === 'list' || sub === 'ls') {
        const active = activeProfile().id;
        const rows = getProfiles().map((p, i) => `${p.id === active ? '●' : ' '} ${String(i + 1).padStart(2)}. ${profileLine(p)}`);
        return app.local(input, [...rows, '', t('profiles.fileHint', { path: tildify(PROFILES_PATH) }), t('profiles.usage')].join('\n'));
      }
      if (sub === 'use' || sub === 'switch') {
        const p = findProfile(arg);
        if (!p) return app.local(input, t('profiles.notFound', { q: arg }));
        setActiveProfile(p.id);
        return app.local(input, t('profiles.switched', { name: p.name, model: p.model || '—' }));
      }
      if (sub === 'remove' || sub === 'delete' || sub === 'rm') {
        const p = findProfile(arg);
        if (!p || p.builtin) return app.local(input, t('profiles.notFound', { q: arg }));
        removeProfile(p.id);
        return app.local(input, t('profiles.removed', { name: p.name }));
      }
      // "/profiles 2" or "/profiles Claude" switches too
      const p = findProfile([sub, ...rest].join(' '));
      if (!p) return app.local(input, t('profiles.usage'));
      setActiveProfile(p.id);
      app.local(input, t('profiles.switched', { name: p.name, model: p.model || '—' }));
    },
    { aliases: ['profile', 'providers'] },
  ),

  cmd('init', 'cmd.init', (args, app) => {
    const data = analyzeProject(app.engine.originalCwd);
    app.runPrompt(`<zero-command name="init">${JSON.stringify(data)}</zero-command>`, '/init');
  }),

  cmd('memory', 'cmd.memory', (args, app) => {
    const file = path.join(app.engine.originalCwd, MEMORY_FILE);
    if (!fs.existsSync(file)) return app.local('/memory', t('memory.none', { file: MEMORY_FILE }));
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    app.local('/memory', `${file}\n\n${lines.slice(0, 40).join('\n')}${lines.length > 40 ? '\n' + t('memory.more', { n: lines.length - 40 }) : ''}`);
  }),

  cmd(
    'permissions',
    'cmd.permissions',
    (args, app) => {
      const e = app.engine;
      const [sub, ...rest] = (args || '').trim().split(/\s+/);
      const rule = rest.join(' ');
      if (sub === 'add' && rule) {
        e.allowRules.add(rule);
        return app.local(`/permissions ${args}`, t('perms.added', { rule }));
      }
      if (sub === 'remove' && rule) {
        const had = e.allowRules.delete(rule);
        return app.local(`/permissions ${args}`, t(had ? 'perms.removed' : 'perms.noRule', { rule }));
      }
      if (sub === 'clear') {
        e.allowRules.clear();
        return app.local(`/permissions ${args}`, t('perms.cleared'));
      }
      const rules = e.allowRules.size ? [...e.allowRules].map((r) => `  ${r}`).join('\n') : `  (${t('common.none')})`;
      app.local('/permissions', `${t('perms.mode', { mode: e.permissionMode })}\n\n${t('perms.rules')}\n${rules}\n\n${t('perms.examples')}`);
    },
    { aliases: ['allowed-tools'] },
  ),

  cmd(
    'settings',
    'cmd.settings',
    (args, app) => {
      const [key, ...rest] = (args || '').trim().split(/\s+/).filter(Boolean);
      if (!key) return app.openSettings();
      if (key === 'reset') {
        resetSettings();
        app.redraw();
        return app.local('/settings reset', t('settings.reset'));
      }
      if (key === 'list') {
        const w = Math.max(...SETTING_DEFS.map((d) => d.key.length)) + 2;
        return app.local(
          '/settings list',
          SETTING_DEFS.map(
            (d) =>
              `${d.key.padEnd(w)}${formatValue(d, settings[d.key])}${d.options ? `  (${d.options.join(' | ')})` : d.type === 'number' ? `  (${d.min}-${d.max})` : ''}`,
          ).join('\n'),
        );
      }
      const def = SETTING_DEFS.find((d) => d.key.toLowerCase() === key.toLowerCase());
      if (!def) return app.local(`/settings ${args}`, t('settings.unknown', { key }));
      if (!rest.length) return app.local(`/settings ${args}`, `${def.key} = ${formatValue(def, settings[def.key])}`);
      const value = setSetting(def.key, rest.join(' '));
      if (REPAINT_KEYS.includes(def.key)) app.redraw();
      app.local(`/settings ${args}`, t('app.settingChanged', { label: settingLabel(def), value: displayValue(def, value) }));
    },
    { aliases: ['config'] },
  ),

  cmd(
    'lang',
    'cmd.language',
    (args, app) => {
      const code = (args || '').trim().toLowerCase();
      const map = { en: 'en', eng: 'en', english: 'en', ru: 'ru', rus: 'ru', russian: 'ru', 'русский': 'ru', 'рус': 'ru' };
      if (!map[code]) return app.local(`/lang ${args}`.trim(), t('lang.usage', { lang: LANGUAGES[settings.language] }));
      setSetting('language', map[code]);
      app.redraw();
      app.local(`/lang ${args}`, t('lang.set'));
    },
    { aliases: ['language'] },
  ),

  cmd('todos', 'cmd.todos', (args, app) => {
    const todos = app.engine.todos;
    app.local('/todos', todos.length ? html`<${TodoList} todos=${[...todos]} />` : t('todos.none'));
  }),

  cmd('tools', 'cmd.tools', (args, app) => {
    const w = Math.max(...TOOLS.map((x) => x.name.length)) + 2;
    const kinds = [t('tools.readOnly'), t('tools.edits'), t('tools.asks')];
    const kw = Math.max(...kinds.map((k) => k.length)) + 2;
    app.local(
      '/tools',
      TOOLS.map((x) => `${x.name.padEnd(w)}${(x.isReadOnly ? kinds[0] : x.isEdit ? kinds[1] : kinds[2]).padEnd(kw)}${x.description}`).join('\n'),
    );
  }),

  cmd('buddy', 'cmd.buddy', (args, app) => {
    const on = app.toggleBuddy();
    app.local('/buddy', t(on ? 'buddy.on' : 'buddy.off', { name: MASCOT_NAME }));
  }),

  cmd('mascot', 'cmd.mascot', (args, app) => {
    const frames = ['idle', 'blink', 'happy', 'surprised'].map(renderSprite);
    app.local(
      '/mascot',
      html`<${Box} flexDirection="column">
        <${Box} flexDirection="row">
          ${frames.map((f, i) => html`<${Box} key=${i} flexDirection="column" marginRight=${2}>${f.map((l, j) => html`<${Text} key=${j}>${l}</${Text}>`)}</${Box}>`)}
        </${Box}>
        <${Text}> </${Text}>
        <${Text}><${Text} bold color=${theme.brand}>${MASCOT_NAME}</${Text}> ${t('mascot.bio', { app: APP_NAME })}</${Text}>
      </${Box}>`,
    );
  }),

  cmd('verbose', 'cmd.verbose', (args, app) => app.toggleVerbose()),

  cmd('doctor', 'cmd.doctor', (args, app) => {
    const shell = getShell();
    const nodeOk = Number(process.versions.node.split('.')[0]) >= 20;
    const colors = process.stdout.hasColors?.(2 ** 24) ? t('doctor.truecolor') : process.stdout.hasColors?.(256) ? t('doctor.256') : t('doctor.limited');
    const term = process.env.TERM_PROGRAM || process.env.TERM || (process.env.WT_SESSION ? 'Windows Terminal' : '?');
    const rows = [
      [`${nodeOk ? '✔' : '✘'} Node.js`, `${process.versions.node}${nodeOk ? '' : t('doctor.needNode')}`],
      [`${fs.existsSync(shell.path) || shell.kind === 'powershell' ? '✔' : '✘'} ${t('status.shell')}`, `${shell.path}`],
      [`✔ ${t('doctor.terminal')}`, `${process.stdout.columns}x${process.stdout.rows}, ${term}`],
      [`✔ ${t('doctor.colors')}`, colors],
      [`• ${t('doctor.model')}`, t('doctor.noApi', { label: app.provider.label })],
    ];
    app.local('/doctor', kv(rows));
  }),

  cmd('exit', 'cmd.exit', (args, app) => app.exit(), { aliases: ['quit'] }),
];

export function findCommand(name) {
  return COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
}
