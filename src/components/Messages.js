import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { html } from './h.js';
import { theme, MASCOT_NAME } from '../theme.js';
import { renderMarkdown, renderInline, highlight } from './markdown.js';
import { getTool } from '../tools/index.js';
import { Welcome } from './Welcome.js';
import { t, tm } from '../i18n.js';
import path from 'node:path';

const COLLAPSED_LINES = 3;
const COLLAPSED_FILE_LINES = 10;

const expandHint = (n) => chalk.dim(t('common.moreLines', { n })) + chalk.dim(t('common.ctrlOExpand'));

/** "  ⎿  " gutter used under every tool call / command. */
export function ResultRow({ children }) {
  return html`
    <${Box} flexDirection="row">
      <${Box} width=${5} flexShrink=${0}><${Text} dimColor>  ⎿  </${Text}></${Box}>
      <${Box} flexDirection="column" flexGrow=${1}>${children}</${Box}>
    </${Box}>
  `;
}

function BlinkingDot({ color }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setOn((v) => !v), 500);
    return () => clearInterval(t);
  }, []);
  return html`<${Text} color=${color}>${on ? '●' : ' '}</${Text}>`;
}

function Bullet({ color, blinking }) {
  return html`
    <${Box} width=${2} flexShrink=${0}>
      ${blinking ? html`<${BlinkingDot} color=${color} />` : html`<${Text} color=${color}>●</${Text}>`}
    </${Box}>
  `;
}

// ---------------------------------------------------------------------------
// Diffs
// ---------------------------------------------------------------------------

function padAnsi(s, width) {
  const visible = s.replace(/\u001b\[[0-9;]*m/g, '').length;
  return visible >= width ? s : s + ' '.repeat(width - visible);
}

export function diffLines(hunks, width, { dim = false, verbose = true } = {}) {
  const out = [];
  const maxLine = Math.max(1, ...hunks.map((h) => Math.max(h.oldStart, h.newStart) + h.lines.length));
  const numW = String(maxLine).length;
  const contentW = Math.max(10, width - numW - 3);
  hunks.forEach((h, hi) => {
    if (hi > 0) out.push(chalk.dim('...'));
    let o = h.oldStart;
    let n = h.newStart;
    for (const line of h.lines) {
      const sign = line[0];
      let body = line.slice(1).replace(/\t/g, '  ');
      if (body.length > contentW) body = body.slice(0, contentW - 1) + '…';
      if (sign === '+') {
        const bg = dim ? theme.diffAddedDimmed : theme.diffAdded;
        out.push(chalk.bgHex(bg)(padAnsi(`${String(n).padStart(numW)} ${chalk.hex('#B5F0B9')('+')}${body}`, width)));
        n++;
      } else if (sign === '-') {
        const bg = dim ? theme.diffRemovedDimmed : theme.diffRemoved;
        out.push(chalk.bgHex(bg)(padAnsi(`${String(o).padStart(numW)} ${chalk.hex('#FFB3BE')('-')}${body}`, width)));
        o++;
      } else {
        out.push(`${chalk.dim(String(n).padStart(numW))}  ${dim ? chalk.dim(body) : body}`);
        o++;
        n++;
      }
    }
  });
  if (!verbose && out.length > 40) return [...out.slice(0, 40), expandHint(out.length - 40)];
  return out;
}

export function fileLines(lines, width, { max, startLine = 1, lang = '' } = {}) {
  const shown = max ? lines.slice(0, max) : lines;
  const numW = String(startLine + shown.length).length;
  const out = shown.map((l, i) => {
    let body = l.replace(/\t/g, '  ');
    if (body.length > width - numW - 2) body = body.slice(0, width - numW - 3) + '…';
    return `${chalk.dim(String(startLine + i).padStart(numW))} ${highlight(body, lang)}`;
  });
  if (max && lines.length > max) out.push(expandHint(lines.length - max));
  return out;
}

// ---------------------------------------------------------------------------
// Tool result bodies
// ---------------------------------------------------------------------------

function ToolResult({ item, columns, verbose }) {
  const width = Math.max(20, columns - 6);
  const { status, display, error, input, name } = item;
  const tool = getTool(name);

  if (status === 'waiting') return null;
  if (status === 'running') {
    if (name === 'Bash') return html`<${ResultRow}><${Text} dimColor>${t('common.running')}</${Text}></${ResultRow}>`;
    return null;
  }
  if (status === 'interrupted') {
    return html`<${ResultRow}><${Text}><${Text} color=${theme.error}>${t('common.interrupted')}</${Text}><${Text} dimColor>${t('common.whatInstead', { name: MASCOT_NAME })}</${Text}></${Text}></${ResultRow}>`;
  }
  if (status === 'rejected') {
    if (item.silent) return null;
    const what = tool?.isEdit ? t(name === 'Write' ? 'common.rejectedWrite' : 'common.rejectedUpdate', { file: tool.renderInput(input, item.ctx) }) : '';
    return html`
      <${ResultRow}>
        <${Text} color=${theme.error}>${t('common.userRejected')}${what ? ` ${what}` : ''}</${Text}>
        ${item.preview?.kind === 'diff' &&
        html`<${Text}>${diffLines(item.preview.hunks, width, { dim: true, verbose }).join('\n')}</${Text}>`}
      </${ResultRow}>
    `;
  }
  if (status === 'error' && display?.kind === 'bash') {
    return html`<${ResultRow}><${BashOutput} display=${display} verbose=${verbose} /></${ResultRow}>`;
  }
  if (status === 'error') {
    const lines = String(error ?? 'Error').split('\n');
    const shown = verbose ? lines : lines.slice(0, 6);
    return html`
      <${ResultRow}>
        <${Text} color=${theme.error}>${(name === 'Bash' ? '' : t('common.errorPrefix')) + shown.join('\n')}</${Text}>
        ${!verbose && lines.length > 6 && html`<${Text}>${expandHint(lines.length - 6)}</${Text}>`}
        ${display && display.kind === 'bash' && html`<${BashOutput} display=${display} verbose=${verbose} />`}
      </${ResultRow}>
    `;
  }
  if (!display) return null;

  switch (display.kind) {
    case 'bash':
      return html`<${ResultRow}><${BashOutput} display=${display} verbose=${verbose} /></${ResultRow}>`;
    case 'diff':
      return html`
        <${ResultRow}>
          <${Text}>${renderInline(tm(display.text))}</${Text}>
          <${Text}>${diffLines(display.hunks, width, { verbose }).join('\n')}</${Text}>
        </${ResultRow}>
      `;
    case 'create': {
      const lang = path.extname(input.file_path ?? '').slice(1);
      const lines = display.lines[display.lines.length - 1] === '' ? display.lines.slice(0, -1) : display.lines;
      return html`
        <${ResultRow}>
          <${Text}>${renderInline(tm(display.text))}</${Text}>
          ${lines.length > 0 &&
          html`<${Text}>${fileLines(lines, width, { max: verbose ? 0 : COLLAPSED_FILE_LINES, lang }).join('\n')}</${Text}>`}
        </${ResultRow}>
      `;
    }
    case 'todos':
      return html`<${ResultRow}><${TodoList} todos=${display.todos} /></${ResultRow}>`;
    case 'summary':
    default: {
      const hasMore = display.lines?.length > 0;
      if (verbose && hasMore) {
        const body =
          name === 'Read'
            ? fileLines(display.lines, width, { startLine: display.startLine, lang: path.extname(input.file_path ?? '').slice(1) })
            : display.lines.map((l) => (l.length > width ? l.slice(0, width - 1) + '…' : l));
        return html`
          <${ResultRow}>
            <${Text}>${renderInline(tm(display.text))}</${Text}>
            <${Text}>${body.join('\n')}</${Text}>
          </${ResultRow}>
        `;
      }
      return html`
        <${ResultRow}>
          <${Text}>${renderInline(tm(display.text))}${hasMore ? chalk.dim(' ' + t('common.ctrlOExpand')) : ''}</${Text}>
        </${ResultRow}>
      `;
    }
  }
}

function BashOutput({ display, verbose }) {
  const out = display.stdout ? display.stdout.split('\n') : [];
  const err = display.stderr ? display.stderr.split('\n') : [];
  if (!out.length && !err.length) {
    return html`<${Text} dimColor>${display.timedOut ? t('common.timedOut') : t('common.noContent')}</${Text}>`;
  }
  const limit = verbose ? Infinity : COLLAPSED_LINES;
  const outShown = out.slice(0, limit);
  const errShown = err.slice(0, Math.max(0, limit - outShown.length));
  const hidden = out.length + err.length - outShown.length - errShown.length;
  return html`
    <${Box} flexDirection="column">
      ${outShown.length > 0 && html`<${Text}>${outShown.join('\n')}</${Text}>`}
      ${errShown.length > 0 && html`<${Text} color=${theme.error}>${errShown.join('\n')}</${Text}>`}
      ${hidden > 0 && html`<${Text}>${expandHint(hidden)}</${Text}>`}
    </${Box}>
  `;
}

export function TodoList({ todos }) {
  if (!todos.length) return html`<${Text} dimColor>${t('common.noTodos')}</${Text}>`;
  return html`
    <${Box} flexDirection="column">
      ${todos.map((t, i) => {
        if (t.status === 'completed') return html`<${Text} key=${i} color=${theme.success}>☒ <${Text} strikethrough dimColor>${t.content}</${Text}></${Text}>`;
        if (t.status === 'in_progress') return html`<${Text} key=${i} bold color=${theme.permission}>☐ ${t.content}</${Text}>`;
        return html`<${Text} key=${i}>☐ ${t.content}</${Text}>`;
      })}
    </${Box}>
  `;
}

// ---------------------------------------------------------------------------
// Message items
// ---------------------------------------------------------------------------

function ToolUse({ item, columns, verbose }) {
  const tool = getTool(item.name);
  const label = tool ? tool.userFacingName(item.input) : item.name;
  const arg = tool ? tool.renderInput(item.input, item.ctx) : JSON.stringify(item.input);
  const argShown = verbose || arg.length < columns - label.length - 6 ? arg : arg.slice(0, Math.max(10, columns - label.length - 8)) + '…';
  const color =
    item.status === 'done' ? theme.success : item.status === 'error' || item.status === 'interrupted' ? theme.error : item.status === 'rejected' ? theme.inactive : theme.inactive;
  return html`
    <${Box} flexDirection="column" marginTop=${1}>
      <${Box} flexDirection="row">
        <${Bullet} color=${color} blinking=${item.status === 'running' || item.status === 'waiting'} />
        <${Text}><${Text} bold>${label}</${Text}>${argShown ? `(${argShown})` : ''}</${Text}>
      </${Box}>
      <${ToolResult} item=${item} columns=${columns} verbose=${verbose} />
    </${Box}>
  `;
}

function AssistantText({ item }) {
  return html`
    <${Box} flexDirection="row" marginTop=${1}>
      <${Bullet} color=${theme.text} />
      <${Box} flexGrow=${1}><${Text}>${renderMarkdown(item.text)}</${Text}></${Box}>
    </${Box}>
  `;
}

function UserPrompt({ item }) {
  return html`
    <${Box} flexDirection="row" marginTop=${1}>
      <${Box} width=${2} flexShrink=${0}><${Text} color=${theme.secondaryText}>></${Text}></${Box}>
      <${Box} flexGrow=${1}><${Text} color=${theme.secondaryText}>${item.text}</${Text}></${Box}>
    </${Box}>
  `;
}

function BashRun({ item, verbose }) {
  return html`
    <${Box} flexDirection="column" marginTop=${1}>
      <${Box} flexDirection="row">
        <${Box} width=${2} flexShrink=${0}><${Text} color=${theme.bashBorder}>!</${Text}></${Box}>
        <${Text}>${item.command}</${Text}>
      </${Box}>
      ${item.running
        ? html`<${ResultRow}><${Text} dimColor>${t('common.running')}</${Text}></${ResultRow}>`
        : item.interrupted
          ? html`<${ResultRow}><${Text} color=${theme.error}>${t('common.interrupted')}</${Text}></${ResultRow}>`
          : html`<${ResultRow}><${BashOutput} display=${item.display} verbose=${verbose} /></${ResultRow}>`}
    </${Box}>
  `;
}

function MemoryNote({ item }) {
  return html`
    <${Box} flexDirection="column" marginTop=${1}>
      <${Box} flexDirection="row">
        <${Box} width=${2} flexShrink=${0}><${Text} color=${theme.memory}>#</${Text}></${Box}>
        <${Text}>${item.text}</${Text}>
      </${Box}>
      <${ResultRow}><${Text} dimColor>${item.result}</${Text}></${ResultRow}>
    </${Box}>
  `;
}

/** Output of a local slash command:  > /cost  then  ⎿ output */
function LocalCommand({ item }) {
  return html`
    <${Box} flexDirection="column" marginTop=${1}>
      ${item.input &&
      html`<${Box} flexDirection="row">
        <${Box} width=${2} flexShrink=${0}><${Text} color=${theme.secondaryText}>></${Text}></${Box}>
        <${Text} color=${theme.secondaryText}>${item.input}</${Text}>
      </${Box}>`}
      ${item.output !== undefined &&
      html`<${ResultRow}>${typeof item.output === 'string' ? html`<${Text} dimColor=${!item.bright}>${item.output}</${Text}>` : item.output}</${ResultRow}>`}
    </${Box}>
  `;
}

/** A turn started by full auto mode rather than by the user. */
function AutoTurn({ item }) {
  return html`
    <${Box} flexDirection="row" marginTop=${1}>
      <${Box} width=${2} flexShrink=${0}><${Text} color=${theme.fullAuto}>↻</${Text}></${Box}>
      <${Text}><${Text} color=${theme.fullAuto}>${t('app.autoTurn')}</${Text}><${Text} dimColor>${t('app.autoContinuing', { step: item.step, max: item.max })}</${Text}></${Text}>
    </${Box}>
  `;
}

function Notice({ item }) {
  const color = item.level === 'error' ? theme.error : item.level === 'warning' ? theme.warning : undefined;
  return html`
    <${Box} marginTop=${1}>
      <${Text} color=${color} dimColor=${!color}>${item.text}</${Text}>
    </${Box}>
  `;
}

export function MessageItem({ item, columns, verbose, cwd, model }) {
  switch (item.type) {
    case 'welcome':
      return html`<${Welcome} columns=${columns} cwd=${cwd} model=${model} />`;
    case 'user':
      return html`<${UserPrompt} item=${item} />`;
    case 'assistant':
      return html`<${AssistantText} item=${item} />`;
    case 'tool':
      return html`<${ToolUse} item=${item} columns=${columns} verbose=${verbose} />`;
    case 'bash':
      return html`<${BashRun} item=${item} verbose=${verbose} />`;
    case 'memory':
      return html`<${MemoryNote} item=${item} />`;
    case 'local':
      return html`<${LocalCommand} item=${item} />`;
    case 'auto':
      return html`<${AutoTurn} item=${item} />`;
    case 'notice':
      return html`<${Notice} item=${item} />`;
    case 'custom':
      return html`<${Box} marginTop=${1}>${item.render()}</${Box}>`;
    default:
      return null;
  }
}
