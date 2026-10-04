import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import { html } from './h.js';
import { theme } from '../theme.js';
import { searchFiles } from '../utils/fileIndex.js';
import { t } from '../i18n.js';

const MODE_PREFIX = { prompt: '>', bash: '!', memory: '#' };
// Functions, not constants, so a theme switch takes effect immediately.
const modeColor = (mode) => ({ prompt: undefined, bash: theme.bashBorder, memory: theme.memory })[mode];

const modeIndicator = (mode) =>
  ({
    acceptEdits: { text: t('mode.acceptEdits'), color: theme.autoAccept },
    plan: { text: t('mode.plan'), color: theme.planMode },
    fullAuto: { text: t('mode.fullAuto'), color: theme.fullAuto },
    bypassPermissions: { text: t('mode.bypassPermissions'), color: theme.error },
  })[mode];

function lineCol(value, cursor) {
  const before = value.slice(0, cursor).split('\n');
  return { line: before.length - 1, col: before[before.length - 1].length };
}

function offsetOf(value, line, col) {
  const lines = value.split('\n');
  let off = 0;
  for (let i = 0; i < line; i++) off += lines[i].length + 1;
  return off + Math.min(col, lines[line].length);
}

function Shortcuts() {
  const col = (items) => html`
    <${Box} flexDirection="column" marginRight=${3} flexShrink=${0}>
      ${items.map((t, i) => html`<${Text} key=${i} dimColor>${t}</${Text}>`)}
    </${Box}>
  `;
  return html`
    <${Box} flexDirection="row" paddingX=${2}>
      ${col(t('shortcuts.col1'))}
      ${col(t('shortcuts.col2'))}
      ${col(t('shortcuts.col3'))}
    </${Box}>
  `;
}

export function PromptInput({
  isActive,
  isLoading,
  columns,
  cwd,
  commands,
  history,
  permissionMode,
  queued,
  notice,
  onSubmit,
  onCycleMode,
  onInterrupt,
  onExit,
}) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState('prompt');
  const [histIdx, setHistIdx] = useState(-1);
  const draft = useRef('');
  const [showHelp, setShowHelp] = useState(false);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState(null); // 'exit' | 'clear'
  const pendingTimer = useRef(null);
  const placeholderIdx = useMemo(() => Math.floor(Math.random() * 6), []);
  const placeholders = t('prompt.placeholders');
  const placeholder = placeholders[placeholderIdx % placeholders.length];

  const set = (v, c = v.length) => {
    setValue(v);
    setCursor(Math.max(0, Math.min(c, v.length)));
    setDismissed(false);
  };

  const arm = (kind) => {
    setPending(kind);
    clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => setPending(null), 1200);
  };
  useEffect(() => () => clearTimeout(pendingTimer.current), []);

  // ---- suggestions -------------------------------------------------------
  const suggestions = useMemo(() => {
    if (dismissed || mode !== 'prompt') return null;
    if (/^\/\S*$/.test(value)) {
      const q = value.slice(1).toLowerCase();
      const starts = commands.filter((c) => c.name.startsWith(q) || c.aliases?.some((a) => a.startsWith(q)));
      const contains = q ? commands.filter((c) => !starts.includes(c) && c.name.includes(q)) : [];
      const list = [...starts, ...contains].slice(0, 10);
      return list.length ? { kind: 'command', items: list.map((c) => ({ value: c.name, label: `/${c.name}`, description: c.description })) } : null;
    }
    const m = /(^|\s)@([^\s]*)$/.exec(value.slice(0, cursor));
    if (m) {
      const files = searchFiles(cwd, m[2]);
      return files.length ? { kind: 'file', query: m[2], items: files.map((f) => ({ value: f, label: `+ ${f}` })) } : null;
    }
    return null;
  }, [value, cursor, mode, dismissed, commands, cwd]);

  useEffect(() => setSel(0), [suggestions?.items.map((i) => i.value).join('|')]);

  const applySuggestion = (submit) => {
    const item = suggestions.items[sel];
    if (!item) return;
    if (suggestions.kind === 'command') {
      if (submit) {
        doSubmit(`/${item.value}`);
      } else {
        set(`/${item.value} `);
      }
      return;
    }
    const before = value.slice(0, cursor).replace(/@[^\s]*$/, `@${item.value}${item.value.endsWith('/') ? '' : ' '}`);
    set(before + value.slice(cursor), before.length);
  };

  const doSubmit = (text) => {
    if (!text.trim()) return;
    onSubmit(text, mode);
    set('');
    setMode('prompt');
    setHistIdx(-1);
    setShowHelp(false);
  };

  // ---- keys ---------------------------------------------------------------
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        if (isLoading) return onInterrupt();
        if (value || mode !== 'prompt') {
          set('');
          setMode('prompt');
          return;
        }
        if (pending === 'exit') return onExit();
        return arm('exit');
      }
      if (key.ctrl && input === 'd') {
        if (!value) return onExit();
        return;
      }
      if (key.escape) {
        if (suggestions) return setDismissed(true);
        if (showHelp) return setShowHelp(false);
        if (isLoading) return onInterrupt();
        if (value) {
          if (pending === 'clear') {
            set('');
            setPending(null);
          } else arm('clear');
        }
        return;
      }
      if (key.tab && key.shift) return onCycleMode();
      if (key.tab) {
        if (suggestions) applySuggestion(false);
        return;
      }
      if (key.return) {
        if (key.meta || key.shift) {
          set(value.slice(0, cursor) + '\n' + value.slice(cursor), cursor + 1);
          return;
        }
        if (cursor > 0 && value[cursor - 1] === '\\') {
          set(value.slice(0, cursor - 1) + '\n' + value.slice(cursor), cursor);
          return;
        }
        if (suggestions && suggestions.items[sel]) {
          if (suggestions.kind === 'file') return applySuggestion(false);
          return applySuggestion(true);
        }
        return doSubmit(value);
      }
      if (key.upArrow || key.downArrow) {
        const up = key.upArrow;
        if (suggestions) {
          const n = suggestions.items.length;
          return setSel((s) => (s + (up ? n - 1 : 1)) % n);
        }
        const { line, col } = lineCol(value, cursor);
        const lines = value.split('\n');
        if (up && line > 0) return setCursor(offsetOf(value, line - 1, col));
        if (!up && line < lines.length - 1) return setCursor(offsetOf(value, line + 1, col));
        // history (newest last)
        if (!history.length) return;
        if (up) {
          const next = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
          if (histIdx === -1) draft.current = value;
          setHistIdx(next);
          const h = history[next];
          setMode(h.startsWith('!') ? 'bash' : 'prompt');
          set(h.startsWith('!') ? h.slice(1) : h);
        } else if (histIdx !== -1) {
          const next = histIdx + 1;
          if (next >= history.length) {
            setHistIdx(-1);
            set(draft.current);
          } else {
            setHistIdx(next);
            const h = history[next];
            setMode(h.startsWith('!') ? 'bash' : 'prompt');
            set(h.startsWith('!') ? h.slice(1) : h);
          }
        }
        return;
      }
      if (key.leftArrow) return setCursor((c) => Math.max(0, c - 1));
      if (key.rightArrow) return setCursor((c) => Math.min(value.length, c + 1));
      if (key.home || (key.ctrl && input === 'a')) {
        const { line } = lineCol(value, cursor);
        return setCursor(offsetOf(value, line, 0));
      }
      if (key.end || (key.ctrl && input === 'e')) {
        const { line } = lineCol(value, cursor);
        return setCursor(offsetOf(value, line, Infinity));
      }
      if (key.backspace || key.delete) {
        if (cursor === 0) {
          if (!value && mode !== 'prompt') setMode('prompt');
          return;
        }
        if (key.meta || (key.ctrl && input === 'w')) {
          const before = value.slice(0, cursor).replace(/\S+\s*$/, '');
          return set(before + value.slice(cursor), before.length);
        }
        return set(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1);
      }
      if (key.ctrl) {
        if (input === 'u') return set(value.slice(cursor), 0);
        if (input === 'k') return set(value.slice(0, cursor), cursor);
        if (input === 'w') {
          const before = value.slice(0, cursor).replace(/\S+\s*$/, '');
          return set(before + value.slice(cursor), before.length);
        }
        return;
      }
      if (key.meta && !input) return;
      if (!input) return;

      // mode switches on an empty prompt
      if (!value && mode === 'prompt') {
        if (input === '!') return setMode('bash');
        if (input === '#') return setMode('memory');
        if (input === '?') return setShowHelp((s) => !s);
      }
      const text = input.replace(/\r\n?/g, '\n');
      setShowHelp(false);
      setHistIdx(-1);
      set(value.slice(0, cursor) + text + value.slice(cursor), cursor + text.length);
    },
    { isActive },
  );

  // ---- render -------------------------------------------------------------
  const ruleColor = modeColor(mode) ?? theme.secondaryBorder;
  const rule = chalk.hex(ruleColor)('─'.repeat(Math.max(1, columns)));
  const prefixColor = modeColor(mode) ?? theme.text;

  const lines = value.split('\n');
  const { line: cLine, col: cCol } = lineCol(value, cursor);
  const rendered = lines.map((l, i) => {
    if (!isActive || i !== cLine) return l;
    const ch = l[cCol] ?? ' ';
    return l.slice(0, cCol) + chalk.inverse(ch) + l.slice(cCol + 1);
  });

  const isEmpty = !value;
  let placeholderText = null;
  if (isEmpty) {
    if (mode === 'prompt') placeholderText = isLoading ? '' : placeholder;
    else if (mode === 'bash') placeholderText = t('prompt.bashPlaceholder');
    else placeholderText = t('prompt.memoryPlaceholder');
  }

  let footerLeft;
  if (pending === 'exit') footerLeft = html`<${Text} dimColor>${t('prompt.exitAgain')}</${Text}>`;
  else if (pending === 'clear') footerLeft = html`<${Text} dimColor>${t('prompt.escAgain')}</${Text}>`;
  else if (mode === 'bash') footerLeft = html`<${Text} color=${theme.bashBorder}>${t('prompt.bashMode')}</${Text}>`;
  else if (mode === 'memory') footerLeft = html`<${Text} color=${theme.memory}>${t('prompt.memoryMode')}</${Text}>`;
  else if (modeIndicator(permissionMode)) {
    const m = modeIndicator(permissionMode);
    footerLeft = html`<${Text}><${Text} color=${m.color}>${m.text}</${Text}><${Text} dimColor>${t('prompt.cycleHint')}</${Text}></${Text}>`;
  } else footerLeft = html`<${Text} dimColor>${t('prompt.shortcutsHint')}</${Text}>`;

  return html`
    <${Box} flexDirection="column" width=${columns}>
      ${queued.length > 0 &&
      html`<${Box} flexDirection="column" marginTop=${1}>
        ${queued.map((q, i) => html`<${Text} key=${i} dimColor>> ${q.display ?? q.text}</${Text}>`)}
      </${Box}>`}
      <${Box} marginTop=${1}><${Text}>${rule}</${Text}></${Box}>
      <${Box} flexDirection="column">
        ${rendered.map(
          (l, i) => html`
            <${Box} key=${i} flexDirection="row">
              <${Box} width=${2} flexShrink=${0}>
                <${Text} color=${prefixColor}>${i === 0 ? MODE_PREFIX[mode] : ' '}</${Text}>
              </${Box}>
              <${Box} flexGrow=${1}>
                ${isEmpty && placeholderText !== null
                  ? html`<${Text}>${isActive ? chalk.inverse((placeholderText || ' ')[0]) + chalk.dim(placeholderText.slice(1)) : chalk.dim(placeholderText)}</${Text}>`
                  : html`<${Text}>${l}</${Text}>`}
              </${Box}>
            </${Box}>
          `,
        )}
      </${Box}>
      <${Text}>${rule}</${Text}>
      ${suggestions
        ? html`<${Box} flexDirection="column" paddingX=${2}>
            ${suggestions.items.map((s, i) => {
              const active = i === sel;
              const w = Math.min(24, Math.max(...suggestions.items.map((x) => x.label.length)) + 2);
              return html`
                <${Box} key=${s.value} flexDirection="row">
                  <${Box} width=${suggestions.kind === 'command' ? w : undefined} flexShrink=${0}>
                    <${Text} color=${active ? theme.suggestion : undefined} dimColor=${!active}>${s.label}</${Text}>
                  </${Box}>
                  ${s.description &&
                  html`<${Text} color=${active ? theme.suggestion : undefined} dimColor=${!active} wrap="truncate-end">${s.description}</${Text}>`}
                </${Box}>
              `;
            })}
          </${Box}>`
        : showHelp
          ? html`<${Shortcuts} />`
          : html`<${Box} flexDirection="row" justifyContent="space-between" paddingX=${2}>
              <${Box} flexShrink=${0}>${footerLeft}</${Box}>
              ${notice ? html`<${Box} flexShrink=${1} marginLeft=${2}><${Text} dimColor wrap="truncate-start">${notice}</${Text}></${Box}>` : null}
            </${Box}>`}
    </${Box}>
  `;
}
