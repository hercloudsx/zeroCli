import React, { useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import chalk from 'chalk';
import { html } from './h.js';
import { theme } from '../theme.js';
import { renderSprite } from '../mascot.js';
import { tildify } from '../utils/paths.js';
import { SETTINGS_SCHEMA, settings, setSetting, SETTINGS_PATH } from '../utils/settings.js';
import { t, tv, LANGUAGES } from '../i18n.js';
import { maskKey } from '../utils/profiles.js';

const ROWS = SETTINGS_SCHEMA; // includes section headers
const SELECTABLE = ROWS.map((r, i) => (r.key ? i : -1)).filter((i) => i >= 0);

export const settingLabel = (def) => t(`setting.${def.key}`);

/** Human-readable, translated value of a setting. */
export function displayValue(def, value) {
  if (def.key === 'language') return LANGUAGES[value] ?? value;
  if (def.type === 'bool') return value ? t('common.on') : t('common.off');
  if (def.type === 'secret') return value ? maskKey(value) : t('common.notSet');
  if (def.type === 'text') return value === '' ? t('common.notSet') : value;
  if (def.type === 'enum') return tv(value);
  return String(value);
}

function nextValue(def, value, dir) {
  if (def.type === 'bool') return !value;
  if (def.type === 'enum') {
    const i = def.options.indexOf(value);
    return def.options[(i + dir + def.options.length) % def.options.length];
  }
  if (def.type === 'number') return Math.min(def.max, Math.max(def.min, value + dir * def.step));
  return value;
}

/**
 * Settings editor in the style of Claude Code's /config.
 * Changes apply and persist immediately; onClose receives a list of what changed.
 */
export function SettingsPanel({ columns, onClose }) {
  const { stdout } = useStdout();
  const [cursor, setCursor] = useState(0); // index into SELECTABLE
  const [editing, setEditing] = useState(null); // text buffer while editing a text setting
  const initial = useRef({ ...settings });
  const [, force] = useState(0);

  const def = ROWS[SELECTABLE[cursor]];

  const change = (value) => {
    setSetting(def.key, value);
    force((x) => x + 1);
  };

  const close = () => {
    const changes = ROWS.filter((r) => r.key && initial.current[r.key] !== settings[r.key]).map((r) => ({
      key: r.key,
      def: r,
      value: settings[r.key],
    }));
    onClose(changes);
  };

  useInput((input, key) => {
    if (editing !== null) {
      if (key.escape) return setEditing(null);
      if (key.return) {
        change(editing.trim());
        return setEditing(null);
      }
      if (key.backspace || key.delete) return setEditing((b) => b.slice(0, -1));
      if (input && !key.ctrl && !key.meta) setEditing((b) => (b + input.replace(/[\r\n]/g, '')).slice(0, 300));
      return;
    }
    if (key.escape || input === 'q' || (key.ctrl && input === 'c')) return close();
    if (key.upArrow || input === 'k') return setCursor((c) => (c + SELECTABLE.length - 1) % SELECTABLE.length);
    if (key.downArrow || input === 'j' || (key.tab && !key.shift)) return setCursor((c) => (c + 1) % SELECTABLE.length);
    if (key.tab && key.shift) return setCursor((c) => (c + SELECTABLE.length - 1) % SELECTABLE.length);
    if (input === 'r') return change(def.default);
    if (def.type === 'text' || def.type === 'secret') {
      // Secrets start empty so the stored key is never echoed back.
      if (key.return || input === ' ') setEditing(def.type === 'secret' ? '' : settings[def.key]);
      return;
    }
    if (key.return || input === ' ' || key.rightArrow || input === 'l') return change(nextValue(def, settings[def.key], 1));
    if (key.leftArrow || input === 'h') return change(nextValue(def, settings[def.key], -1));
  });

  // Scroll window so the panel fits short terminals.
  const maxRows = Math.max(8, (stdout.rows || 40) - 12);
  const selRow = SELECTABLE[cursor];
  let start = 0;
  if (ROWS.length > maxRows) start = Math.min(Math.max(0, selRow - Math.floor(maxRows / 2)), ROWS.length - maxRows);
  const visible = ROWS.slice(start, start + maxRows);

  const labelW = Math.max(...ROWS.filter((r) => r.key).map((r) => settingLabel(r).length)) + 4;
  const showPreview = columns >= 90;

  const renderValue = (r, active) => {
    if (active && editing !== null) {
      const shown = r.type === 'secret' ? '•'.repeat(editing.length) : editing;
      return chalk.hex(theme.suggestion)(shown.length > 60 ? '…' + shown.slice(-59) : shown) + chalk.inverse(' ');
    }
    const v = settings[r.key];
    let text = displayValue(r, v);
    if (r.type === 'enum' || r.type === 'number') text = active ? `‹ ${text} ›` : `  ${text}  `;
    if (r.type === 'bool') text = `${v ? '✔' : '✘'} ${text}`;
    const color = active ? theme.suggestion : r.type === 'bool' ? (v ? theme.success : theme.inactive) : undefined;
    let out = color ? chalk.hex(color)(text) : text;
    if (settings[r.key] !== r.default) out += chalk.dim(' •');
    return out;
  };

  const desc = t(`setting.${def.key}.desc`);

  return html`
    <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.permission} paddingX=${1} marginTop=${1} width=${columns}>
      <${Text} bold color=${theme.permission}>${t('settings.title')}</${Text}>
      <${Text} dimColor>${t('settings.subtitle', { path: tildify(SETTINGS_PATH) })}</${Text}>
      <${Box} flexDirection="row" marginTop=${1}>
        <${Box} flexDirection="column" flexGrow=${1}>
          ${start > 0 && html`<${Text} dimColor>${t('settings.moreUp')}</${Text}>`}
          ${visible.map((r, i) => {
            const rowIndex = start + i;
            if (!r.key) {
              return html`<${Box} key=${'s' + rowIndex} marginTop=${i === 0 ? 0 : 1}><${Text} bold dimColor>${t(`section.${r.section}`)}</${Text}></${Box}>`;
            }
            const active = rowIndex === selRow;
            return html`
              <${Box} key=${r.key} flexDirection="row">
                <${Box} width=${labelW} flexShrink=${0}>
                  <${Text} color=${active ? theme.suggestion : undefined}>${active ? '❯ ' : '  '}${settingLabel(r)}</${Text}>
                </${Box}>
                <${Text}>${renderValue(r, active)}</${Text}>
              </${Box}>
            `;
          })}
          ${start + maxRows < ROWS.length && html`<${Text} dimColor>${t('settings.moreDown')}</${Text}>`}
        </${Box}>
        ${showPreview &&
        html`<${Box} flexDirection="column" alignItems="center" width=${22} flexShrink=${0}>
          ${renderSprite('happy').map((l, i) => html`<${Text} key=${i}>${l}</${Text}>`)}
          <${Text} dimColor>${t('settings.preview')}</${Text}>
        </${Box}>`}
      </${Box}>
      <${Box} marginTop=${1} flexDirection="column">
        ${desc !== `setting.${def.key}.desc` ? html`<${Text} dimColor>${desc}</${Text}>` : html`<${Text}> </${Text}>`}
        ${def.key === 'permissionMode' && settings.permissionMode === 'fullAuto'
          ? html`<${Text} color=${theme.fullAuto}>${t('settings.fullAutoWarning')}</${Text}>`
          : null}
        <${Text} dimColor>${editing !== null ? t('settings.editHint') : t('settings.hint')}</${Text}>
      </${Box}>
    </${Box}>
  `;
}
