import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import { html } from './h.js';
import { theme } from '../theme.js';
import { tildify } from '../utils/paths.js';
import { CHATS_DIR } from '../utils/chats.js';
import { t, timeAgo, fmtTokens } from '../i18n.js';

/**
 * Picker for saved chats, in the style of the settings panel.
 * chats: [{ id, name, updatedAt, messages, tokens, current }]
 */
export function ChatPanel({ columns, chats, onOpen, onNew, onRename, onDelete, onClose }) {
  const [cursor, setCursor] = useState(Math.max(0, chats.findIndex((c) => c.current)));
  const [editing, setEditing] = useState(null); // rename buffer
  const [confirmDelete, setConfirmDelete] = useState(null); // chat id awaiting a second "d"

  const sel = chats[cursor];

  useInput((input, key) => {
    if (editing !== null) {
      if (key.escape) return setEditing(null);
      if (key.return) {
        if (editing.trim()) onRename(sel.id, editing.trim());
        return setEditing(null);
      }
      if (key.backspace || key.delete) return setEditing((b) => b.slice(0, -1));
      if (input && !key.ctrl && !key.meta) setEditing((b) => (b + input.replace(/[\r\n]/g, '')).slice(0, 60));
      return;
    }
    if (key.escape || input === 'q' || (key.ctrl && input === 'c')) return onClose();
    if (key.upArrow || input === 'k') {
      setConfirmDelete(null);
      return setCursor((c) => (c + chats.length - 1) % chats.length);
    }
    if (key.downArrow || input === 'j' || key.tab) {
      setConfirmDelete(null);
      return setCursor((c) => (c + 1) % chats.length);
    }
    if (input === 'n') return onNew();
    if (!sel) return;
    if (key.return) return onOpen(sel.id);
    if (input === 'r') return setEditing(sel.name);
    if (input === 'd') {
      if (confirmDelete === sel.id) {
        setConfirmDelete(null);
        setCursor((c) => Math.max(0, Math.min(c, chats.length - 2)));
        return onDelete(sel.id);
      }
      return setConfirmDelete(sel.id);
    }
  });

  const nameW = Math.min(48, Math.max(12, ...chats.map((c) => c.name.length)) + 2);

  return html`
    <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.permission} paddingX=${1} marginTop=${1} width=${columns}>
      <${Text} bold color=${theme.permission}>${t('chat.title')}</${Text}>
      <${Text} dimColor>${t('chat.subtitle', { path: tildify(CHATS_DIR) })}</${Text}>
      <${Box} flexDirection="column" marginTop=${1}>
        ${chats.map((c, i) => {
          const active = i === cursor;
          const name = active && editing !== null ? chalk.hex(theme.suggestion)(editing) + chalk.inverse(' ') : c.name;
          const meta = [timeAgo(c.updatedAt), t('chat.messages', { n: c.messages }), t('tokens.chat', { n: fmtTokens(c.tokens), raw: c.tokens })].join(' · ');
          return html`
            <${Box} key=${c.id} flexDirection="row">
              <${Box} width=${4} flexShrink=${0}>
                <${Text} color=${theme.suggestion}>${active ? '❯ ' : '  '}</${Text}>
                <${Text} color=${c.current ? theme.success : theme.subtle}>${c.current ? '●' : '○'}</${Text}>
              </${Box}>
              <${Box} width=${nameW} flexShrink=${0}>
                <${Text} color=${active ? theme.suggestion : undefined} wrap="truncate-end">${name}</${Text}>
              </${Box}>
              <${Text} dimColor wrap="truncate-end">${meta}${c.current ? ` · ${t('chat.current')}` : ''}</${Text}>
            </${Box}>
          `;
        })}
      </${Box}>
      <${Box} marginTop=${1}>
        ${confirmDelete
          ? html`<${Text} color=${theme.error}>${t('chat.confirmDelete', { name: sel?.name })}</${Text}>`
          : html`<${Text} dimColor>${editing !== null ? t('chat.renameHint') : t('chat.hint')}</${Text}>`}
      </${Box}>
    </${Box}>
  `;
}
