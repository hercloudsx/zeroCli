import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { Box, Static, Text, useApp, useInput, useStdout } from 'ink';
import { html } from './components/h.js';
import { theme, MASCOT_NAME } from './theme.js';
import { Engine, AbortError, newId } from './agent/engine.js';
import { PERMISSION_MODES } from './agent/permissions.js';
import { createProvider } from './providers/index.js';
import { activeProfile, subscribeProfiles, getProfile, setActiveProfile } from './utils/profiles.js';
import { MessageItem, ResultRow } from './components/Messages.js';
import { PromptInput } from './components/PromptInput.js';
import { PermissionDialog } from './components/PermissionDialog.js';
import { Spinner, getVerbs, getTips } from './components/Spinner.js';
import { SettingsPanel, settingLabel, displayValue } from './components/SettingsPanel.js';
import { t } from './i18n.js';
import { Buddy, BUDDY_WIDTH, BUBBLE_WIDTH } from './components/Buddy.js';
import { COMMANDS, findCommand } from './commands/index.js';
import { runShell } from './tools/bash.js';
import { appendHistory, loadHistory, MEMORY_FILE } from './utils/config.js';
import { settings, subscribe, setSetting } from './utils/settings.js';
import { ChatPanel } from './components/ChatPanel.js';
import { ProfilesPanel } from './components/ProfilesPanel.js';
import { newChatId, saveChat, loadChat, deleteChat, listChats, titleFrom, transcriptFrom } from './utils/chats.js';
import { fmtTokens } from './i18n.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const CLEAR_SCREEN = '\u001b[2J\u001b[3J\u001b[H';

const isSettled = (item) =>
  item.type === 'assistant' ? item.done : item.type === 'tool' ? !['running', 'waiting'].includes(item.status) : item.type === 'bash' ? !item.running : true;

export function App({ permissionMode: initialMode = settings.permissionMode, allowBypass = false, initialPrompt }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [columns, setColumns] = useState(stdout.columns || 80);
  useEffect(() => {
    const onResize = () => setColumns(stdout.columns || 80);
    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [stdout]);

  const engineRef = useRef(null);
  if (!engineRef.current) {
    engineRef.current = new Engine({ cwd: process.cwd(), provider: createProvider(activeProfile()), permissionMode: initialMode });
  }
  const engine = engineRef.current;

  const [provider, setProviderState] = useState(engine.provider);
  const [permissionMode, setPermissionModeState] = useState(engine.permissionMode);
  const [committed, setCommitted] = useState([{ type: 'welcome', id: 'welcome' }]);
  const [staticKey, setStaticKey] = useState(0);
  const [live, setLive] = useState([]);
  const liveRef = useRef([]);
  const [loading, setLoading] = useState(null); // { startedAt, verb, tip, label }
  const loadingRef = useRef(false);
  const [tokens, setTokens] = useState(0);
  const [dialog, setDialog] = useState(null); // { req, resolve }
  const abortRef = useRef(null);
  const toolInterruptedRef = useRef(false);
  const lastToolFailedRef = useRef(false);
  const [queued, setQueued] = useState([]);
  const queueRef = useRef([]);
  const [verbose, setVerbose] = useState(settings.verbose);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatPanel, setChatPanel] = useState(null); // list of chats while the picker is open
  const [profilesOpen, setProfilesOpen] = useState(false);
  const chatRef = useRef({ id: newChatId(), name: null, createdAt: Date.now() });
  const [chatTokens, setChatTokens] = useState(0);
  const autoStepsRef = useRef(0);
  const [, setSettingsVersion] = useState(0);
  const [buddy, setBuddy] = useState({ mood: 'idle', speech: settings.buddySpeech ? t('buddy.hello', { name: MASCOT_NAME }) : null });
  const buddyTimer = useRef(null);
  const [history, setHistory] = useState(() =>
    loadHistory()
      .filter((h) => h.cwd === process.cwd())
      .map((h) => h.text),
  );

  // ---- buddy reactions ----------------------------------------------------
  const react = useCallback((mood, speech, ms = 3500) => {
    clearTimeout(buddyTimer.current);
    setBuddy({ mood, speech: settings.buddySpeech ? speech : null });
    buddyTimer.current = setTimeout(() => setBuddy({ mood: 'idle', speech: null }), ms);
  }, []);
  useEffect(() => {
    buddyTimer.current = setTimeout(() => setBuddy({ mood: 'idle', speech: null }), 6000);
    return () => clearTimeout(buddyTimer.current);
  }, []);

  // ---- settings ------------------------------------------------------------
  useEffect(
    () =>
      subscribe((key, value) => {
        setSettingsVersion((v) => v + 1);
        if (key === 'permissionMode') {
          engine.permissionMode = value;
          setPermissionModeState(value);
        }
        if (key === 'verbose') setVerbose(value);
      }),
    [],
  );

  // Switching or editing a profile swaps the provider; the conversation carries over.
  // The welcome banner lives in <Static>, so repaint it to show the new model.
  useEffect(
    () =>
      subscribeProfiles((profile) => {
        const prev = engine.provider;
        engine.provider = createProvider(profile);
        setProviderState(engine.provider);
        if (prev.label !== engine.provider.label || prev.description !== engine.provider.description) clearScreenKeep();
      }),
    [],
  );

  // ---- transcript helpers -------------------------------------------------
  const commit = useCallback((items) => setCommitted((c) => [...c, ...items]), []);

  const updateLive = useCallback(
    (fn, flushAll = false) => {
      let next = fn(liveRef.current);
      let i = 0;
      if (flushAll) i = next.length;
      else while (i < next.length && isSettled(next[i])) i++;
      if (i > 0) {
        commit(next.slice(0, i));
        next = next.slice(i);
      }
      liveRef.current = next;
      setLive(next);
    },
    [commit],
  );

  const patchItem = (id, patch) => updateLive((items) => items.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const clearScreen = useCallback((items = []) => {
    stdout.write(CLEAR_SCREEN);
    setCommitted([{ type: 'welcome', id: newId('welcome') }, ...items]);
    setStaticKey((k) => k + 1);
  }, [stdout]);

  // Repaint the whole transcript (after theme / mascot changes).
  const clearScreenKeep = useCallback(() => {
    stdout.write(CLEAR_SCREEN);
    setStaticKey((k) => k + 1);
  }, [stdout]);

  const toggleVerbose = useCallback(() => {
    stdout.write(CLEAR_SCREEN);
    setVerbose((v) => !v);
    setStaticKey((k) => k + 1);
  }, [stdout]);

  const setPermissionMode = (m) => {
    engine.permissionMode = m;
    setPermissionModeState(m);
  };

  const cycleMode = () => {
    const modes = PERMISSION_MODES.filter((m) => m !== 'bypassPermissions' || allowBypass);
    const next = modes[(modes.indexOf(engine.permissionMode) + 1) % modes.length];
    setPermissionMode(next);
    if (next === 'fullAuto') react('happy', t('buddy.fullAuto'), 3000);
  };

  // ---- chats --------------------------------------------------------------
  const chatName = () => chatRef.current.name ?? titleFrom(engine.messages) ?? t('chat.untitled');

  /** Persist the current chat (only once it has something in it) and refresh the token count. */
  const saveCurrentChat = () => {
    const tokensNow = engine.contextTokens();
    setChatTokens(tokensNow);
    if (!engine.messages.length) return;
    try {
      saveChat({
        id: chatRef.current.id,
        name: chatName(),
        cwd: engine.originalCwd,
        createdAt: chatRef.current.createdAt,
        updatedAt: Date.now(),
        tokens: tokensNow,
        profileId: activeProfile().id,
        data: engine.serialize(),
      });
    } catch {}
  };

  const chatList = () => {
    const saved = listChats(engine.originalCwd);
    const current = chatRef.current.id;
    const entries = saved.map((c) => ({ ...c, current: c.id === current }));
    if (!entries.some((c) => c.current)) {
      entries.unshift({ id: current, name: chatName(), updatedAt: Date.now(), messages: engine.messages.length, tokens: engine.contextTokens(), current: true });
    }
    return entries;
  };

  const busy = () => {
    if (!loadingRef.current) return false;
    app.local('/chat', t('chat.busy'));
    return true;
  };

  const newChat = (name) => {
    if (busy()) return;
    saveCurrentChat();
    engine.clear();
    engine.cwd = engine.originalCwd;
    chatRef.current = { id: newChatId(), name: name || null, createdAt: Date.now() };
    setChatTokens(0);
    setChatPanel(null);
    clearScreen([{ type: 'notice', id: newId('chat'), text: t('chat.created', { name: name ? ` “${name}”` : '' }) }]);
  };

  const openChat = (id) => {
    if (id === chatRef.current.id) return setChatPanel(null);
    if (busy()) return;
    const chat = loadChat(id);
    if (!chat) return app.local('/chat', t('chat.notFound', { q: id }));
    saveCurrentChat();
    engine.restore(chat.data ?? {});
    chatRef.current = { id: chat.id, name: chat.name, createdAt: chat.createdAt };
    // Each chat remembers its provider profile, so different chats can use different providers.
    const chatProfile = chat.profileId && getProfile(chat.profileId);
    const switchedProfile = chatProfile && chatProfile.id !== activeProfile().id;
    if (switchedProfile) setActiveProfile(chatProfile.id);
    const tokensNow = engine.contextTokens();
    setChatTokens(tokensNow);
    setChatPanel(null);
    const notice = t('chat.switched', {
      name: chat.name,
      messages: t('chat.messages', { n: engine.messages.length }),
      tokens: t('tokens.chat', { n: fmtTokens(tokensNow), raw: tokensNow }),
    });
    const profileNotice = switchedProfile ? [{ type: 'notice', id: newId('profile'), text: t('profiles.chatSwitched', { name: chatProfile.name }) }] : [];
    clearScreen([{ type: 'notice', id: newId('chat'), text: notice }, ...profileNotice, ...transcriptFrom(engine.messages, engine.displays, engine.cwd)]);
  };

  const renameChat = (id, name) => {
    if (id === chatRef.current.id) {
      chatRef.current.name = name;
      saveCurrentChat();
    } else {
      const chat = loadChat(id);
      if (chat) saveChat({ ...chat, name });
    }
    if (chatPanel) setChatPanel(chatList());
    return name;
  };

  const removeChat = (id) => {
    const isCurrent = id === chatRef.current.id;
    if (isCurrent && busy()) return;
    deleteChat(id);
    if (isCurrent) {
      engine.clear();
      chatRef.current = { id: newChatId(), name: null, createdAt: Date.now() };
      setChatTokens(0);
      clearScreen();
    }
    if (chatPanel) setChatPanel(chatList());
  };

  // ---- running turns ------------------------------------------------------
  const startLoading = (label) => {
    loadingRef.current = true;
    setTokens(0);
    setLoading({ startedAt: Date.now(), verb: pick(getVerbs()), tip: settings.showTips && Math.random() < 0.5 ? pick(getTips()) : null, label });
    abortRef.current = new AbortController();
    return abortRef.current.signal;
  };

  const stopLoading = () => {
    loadingRef.current = false;
    abortRef.current = null;
    setLoading(null);
    const next = queueRef.current.shift();
    setQueued([...queueRef.current]);
    if (next) {
      setTimeout(() => {
        if (next.mode === 'raw') runPrompt(next.text, next.display);
        else if (next.mode === 'auto') runPrompt(next.text, undefined, next.step);
        else submit(next.text, next.mode, true);
      }, 0);
    }
  };

  const ui = {
    onText: (id, text, done) => {
      const exists = liveRef.current.some((i) => i.id === id);
      if (exists) patchItem(id, { text, done });
      else updateLive((items) => [...items, { type: 'assistant', id, text, done }]);
    },
    onToolStart: (block) =>
      updateLive((items) => [...items, { type: 'tool', id: block.id, name: block.name, input: block.input, status: 'running', ctx: { cwd: engine.cwd } }]),
    onToolEnd: (id, outcome) => {
      if (outcome.status === 'interrupted') toolInterruptedRef.current = true;
      lastToolFailedRef.current = outcome.status === 'error';
      patchItem(id, outcome);
      if (outcome.status === 'error') react('surprised', pick(t('buddy.toolError')), 2500);
    },
    onTokens: (n) => setTokens(n),
    onModeChange: (m) => setPermissionModeState(m),
    requestPermission: (req) =>
      new Promise((resolve) => {
        patchItem(req.id, { status: 'waiting', preview: req.preview });
        react('idle', t('buddy.mayI'), 8000);
        setDialog({ req, resolve });
      }),
  };

  const runPrompt = async (text, display, autoStep = 0) => {
    if (!autoStep) autoStepsRef.current = 0;
    commit([autoStep ? { type: 'auto', id: newId('auto'), step: autoStep, max: settings.fullAutoMaxSteps } : { type: 'user', id: newId('user'), text: display ?? text }]);
    const signal = startLoading();
    toolInterruptedRef.current = false;
    lastToolFailedRef.current = false;
    try {
      const result = await engine.runTurn(text, ui, signal);
      if (result === 'done' && lastToolFailedRef.current) react('surprised', pick(t('buddy.failed')));
      else if (result === 'done') react('happy', pick(t('buddy.done')));
      else react('idle', t('buddy.whatInstead'));
      if (result === 'done') scheduleAutoContinue();
      if (settings.bell) stdout.write('\u0007');
    } catch (e) {
      if (e instanceof AbortError) {
        const hadTool = toolInterruptedRef.current || liveRef.current.some((i) => i.type === 'tool' && !isSettled(i));
        updateLive((items) => items.map((i) => (i.type === 'tool' && !isSettled(i) ? { ...i, status: 'interrupted' } : i.type === 'assistant' ? { ...i, done: true } : i)), true);
        if (!hadTool) {
          commit([
            {
              type: 'local',
              id: newId('int'),
              output: html`<${Text}><${Text} color=${theme.error}>${t('common.interrupted')}</${Text}><${Text} dimColor>${t('common.whatInstead', { name: MASCOT_NAME })}</${Text}></${Text}>`,
            },
          ]);
        }
        react('surprised', t('buddy.stopped'));
      } else {
        commit([{ type: 'notice', id: newId('err'), level: 'error', text: t('common.apiError', { msg: e.message }) }]);
        react('surprised', t('buddy.broke'));
      }
    } finally {
      updateLive((items) => items.map((i) => (i.type === 'assistant' ? { ...i, done: true } : i)), true);
      setDialog(null);
      saveCurrentChat();
      stopLoading();
    }
  };

  /** Full auto: keep working through unfinished todos on our own, up to the configured limit. */
  const scheduleAutoContinue = () => {
    if (engine.permissionMode !== 'fullAuto' || !settings.fullAutoContinue) return;
    if (!engine.todos.some((t) => t.status !== 'completed')) return;
    if (autoStepsRef.current >= settings.fullAutoMaxSteps) {
      commit([{ type: 'notice', id: newId('auto'), level: 'warning', text: t('app.autoPaused', { n: settings.fullAutoMaxSteps }) }]);
      return;
    }
    autoStepsRef.current++;
    queueRef.current.push({ text: 'continue', mode: 'auto', step: autoStepsRef.current, display: '↻ continue (full auto)' });
    setQueued([...queueRef.current]);
  };

  const runBash = async (command) => {
    const id = newId('bash');
    updateLive((items) => [...items, { type: 'bash', id, command, running: true }]);
    const signal = startLoading(t('common.runningLabel'));
    try {
      const res = await runShell(command, { cwd: engine.cwd, signal, timeout: settings.bashTimeout * 1000 });
      if (res.cwd && res.cwd !== engine.cwd) engine.cwd = res.cwd;
      patchItem(id, { running: false, interrupted: res.interrupted, display: { stdout: res.stdout, stderr: res.stderr, code: res.code } });
      engine.messages.push({
        role: 'user',
        content: [{ type: 'text', text: `<bash-input>${command}</bash-input>\n<bash-stdout>${res.stdout}</bash-stdout><bash-stderr>${res.stderr}</bash-stderr>` }],
      });
    } finally {
      updateLive((x) => x, true);
      saveCurrentChat();
      stopLoading();
    }
  };

  const addMemory = (text) => {
    const file = path.join(engine.originalCwd, MEMORY_FILE);
    let result;
    try {
      const exists = fs.existsSync(file);
      const prefix = exists ? (fs.readFileSync(file, 'utf8').endsWith('\n') ? '' : '\n') : `# ${MEMORY_FILE}\n\n`;
      fs.appendFileSync(file, `${prefix}- ${text}\n`);
      result = t('app.memorySaved', { file: MEMORY_FILE });
      react('happy', t('buddy.remember'));
    } catch (e) {
      result = t('app.memoryFailed', { msg: e.message });
    }
    commit([{ type: 'memory', id: newId('mem'), text, result }]);
  };

  const app = {
    engine,
    provider,
    setProvider: (p) => {
      engine.provider = p;
      setProviderState(p);
    },
    local: (input, output) => commit([{ type: 'local', id: newId('local'), input, output }]),
    clearScreen,
    toggleVerbose,
    toggleBuddy: () => setSetting('showBuddy', !settings.showBuddy),
    openSettings: () => setSettingsOpen(true),
    openChats: () => setChatPanel(chatList()),
    openProfiles: () => setProfilesOpen(true),
    chatList,
    newChat,
    openChat,
    renameChat: (name) => renameChat(chatRef.current.id, name),
    removeChat,
    currentChatId: () => chatRef.current.id,
    chatChanged: saveCurrentChat,
    redraw: () => clearScreenKeep(),
    runPrompt: (text, display) => {
      if (loadingRef.current) {
        queueRef.current.push({ text, mode: 'raw', display });
        setQueued([...queueRef.current]);
      } else runPrompt(text, display);
    },
    exit: () => exit(),
  };

  function submit(text, mode, fromQueue = false) {
    if (!fromQueue) {
      appendHistory(mode === 'bash' ? `!${text}` : text, process.cwd());
      setHistory((h) => [...h.filter((x) => x !== text), mode === 'bash' ? `!${text}` : text]);
    }
    if (mode === 'memory') return addMemory(text.trim());
    if (mode === 'prompt' && text.trim().startsWith('/')) {
      const [name, ...rest] = text.trim().slice(1).split(/\s+/);
      const cmd = findCommand(name);
      if (cmd) return cmd.run(rest.join(' '), app);
      return app.local(text.trim(), t('app.unknownCommand', { name }));
    }
    if (loadingRef.current) {
      queueRef.current.push({ text, mode });
      setQueued([...queueRef.current]);
      return;
    }
    if (mode === 'bash') return runBash(text);
    return runPrompt(text);
  }

  useEffect(() => {
    if (initialPrompt) submit(initialPrompt, 'prompt');
  }, []);

  const interrupt = () => {
    queueRef.current = queueRef.current.filter((q) => q.mode !== 'auto');
    setQueued([...queueRef.current]);
    abortRef.current?.abort();
  };

  // Global keys that work even while the permission dialog is open.
  useInput((input, key) => {
    if (key.ctrl && input === 'o') return toggleVerbose();
    if (dialog && key.ctrl && input === 'c') {
      const d = dialog;
      setDialog(null);
      interrupt();
      d.resolve('no');
    }
  });

  const answerPermission = (answer) => {
    const d = dialog;
    setDialog(null);
    if (answer === 'always' && d.req.always.mode) setPermissionModeState(d.req.always.mode);
    if (answer !== 'no') patchItem(d.req.id, { status: 'running' });
    react(answer === 'no' ? 'surprised' : 'happy', answer === 'no' ? t('buddy.okay') : t('buddy.thanks'), 2000);
    d.resolve(answer);
  };

  // ---- layout ------------------------------------------------------------
  const closeSettings = (changes) => {
    setSettingsOpen(false);
    const repaint = changes.some((c) => ['language', 'theme', 'hairColor', 'eyeColor', 'displayName', 'verbose'].includes(c.key));
    if (repaint) clearScreenKeep();
    commit([
      {
        type: 'local',
        id: newId('settings'),
        input: '/settings',
        output: changes.length ? changes.map((c) => t('app.settingChanged', { label: settingLabel(c.def), value: displayValue(c.def, c.value) })).join('\n') : t('app.settingsDismissed'),
      },
    ]);
  };

  const showBuddy = settings.showBuddy && columns >= 100 && !dialog && !settingsOpen && !chatPanel && !profilesOpen;
  // Always-on footer info: which chat this is and how big it has grown.
  const shortName = chatName().length > 24 ? chatName().slice(0, 23) + '…' : chatName();
  const chatInfo = `${activeProfile().name} · ${shortName} · ${t('tokens.chat', { n: fmtTokens(chatTokens), raw: chatTokens })}`;
  const footerNotice = [verbose ? t('prompt.verboseOn') : null, chatInfo].filter(Boolean).join(' · ');
  const promptWidth = showBuddy ? columns - BUDDY_WIDTH - BUBBLE_WIDTH : columns;
  const model = { label: provider.label, description: provider.description };

  return html`
    <${Box} flexDirection="column" width=${columns}>
      <${Static} key=${staticKey} items=${committed}>
        ${(item) => html`<${Box} key=${item.id} width=${columns}><${MessageItem} key=${item.id} item=${item} columns=${columns} verbose=${verbose} cwd=${engine.originalCwd} model=${model} /></${Box}>`}
      </${Static}>
      ${live.map((item) => html`<${MessageItem} key=${item.id} item=${item} columns=${columns} verbose=${verbose} cwd=${engine.originalCwd} model=${model} />`)}
      ${loading && !dialog && html`<${Spinner} verb=${loading.verb} label=${loading.label} startedAt=${loading.startedAt} tokens=${tokens} tip=${loading.tip} chatTokens=${chatTokens} />`}
      ${settingsOpen
        ? html`<${SettingsPanel} columns=${columns} onClose=${closeSettings} />`
        : profilesOpen
        ? html`<${ProfilesPanel} columns=${columns} onClose=${() => setProfilesOpen(false)} />`
        : chatPanel
        ? html`<${ChatPanel}
            columns=${columns}
            chats=${chatPanel}
            onOpen=${openChat}
            onNew=${() => newChat()}
            onRename=${renameChat}
            onDelete=${removeChat}
            onClose=${() => setChatPanel(null)}
          />`
        : dialog
        ? html`<${PermissionDialog} key=${dialog.req.id} req=${dialog.req} columns=${columns} onAnswer=${answerPermission} />`
        : html`
          <${Box} flexDirection="row" alignItems="flex-end">
            <${PromptInput}
              isActive=${!dialog && !settingsOpen && !chatPanel && !profilesOpen}
              isLoading=${!!loading}
              columns=${promptWidth}
              cwd=${engine.cwd}
              commands=${COMMANDS}
              history=${history}
              permissionMode=${permissionMode}
              queued=${queued}
              notice=${footerNotice}
              onSubmit=${submit}
              onCycleMode=${cycleMode}
              onInterrupt=${interrupt}
              onExit=${() => exit()}
            />
            ${showBuddy && html`<${Buddy} mood=${buddy.mood} speech=${buddy.speech} busy=${!!loading} />`}
          </${Box}>
        `}
    </${Box}>
  `;
}
