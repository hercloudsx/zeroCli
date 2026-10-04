import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import path from 'node:path';
import { html } from './h.js';
import { theme, MASCOT_NAME } from '../theme.js';
import { diffLines, fileLines } from './Messages.js';
import { resolvePath, displayPath } from '../utils/paths.js';
import { t } from '../i18n.js';

function describe(req) {
  const { tool, input, preview, cwd } = req;
  const file = input.file_path ? resolvePath(input.file_path, cwd) : '';
  const base = file ? path.basename(file) : '';
  switch (tool.name) {
    case 'Bash':
      return { title: t('perm.bash.title'), question: t('perm.q.proceed') };
    case 'Edit':
      return { title: t('perm.edit.title'), question: t('perm.q.edit', { file: base }), file };
    case 'Write':
      return preview?.kind === 'create'
        ? { title: t('perm.create.title'), question: t('perm.q.create', { file: base }), file }
        : { title: t('perm.overwrite.title'), question: t('perm.q.overwrite', { file: base }), file };
    case 'WebFetch':
      return { title: t('perm.fetch.title'), question: t('perm.q.fetch', { name: MASCOT_NAME }) };
    default:
      return { title: tool.name, question: t('perm.q.proceed') };
  }
}

function Body({ req, columns }) {
  const { tool, input, preview, cwd } = req;
  const inner = Math.max(20, columns - 8);
  if (tool.name === 'Bash') {
    return html`
      <${Box} flexDirection="column" paddingX=${2} paddingY=${1}>
        <${Text}>${input.command}</${Text}>
        ${input.description && html`<${Text} dimColor>${input.description}</${Text}>`}
      </${Box}>
    `;
  }
  if (tool.name === 'WebFetch') {
    return html`
      <${Box} flexDirection="column" paddingX=${2} paddingY=${1}>
        <${Text}>${input.url}</${Text}>
        ${input.prompt && html`<${Text} dimColor>${input.prompt}</${Text}>`}
      </${Box}>
    `;
  }
  if (preview) {
    const shown = displayPath(resolvePath(input.file_path, cwd), cwd);
    const lines =
      preview.kind === 'diff'
        ? diffLines(preview.hunks, inner - 2)
        : fileLines(
            preview.lines[preview.lines.length - 1] === '' ? preview.lines.slice(0, -1) : preview.lines,
            inner - 2,
            { max: 30, lang: path.extname(input.file_path).slice(1) },
          );
    return html`
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.subtle} paddingX=${1} marginY=${1}>
        <${Text} bold>${shown}</${Text}>
        <${Text}> </${Text}>
        <${Text}>${lines.length ? lines.join('\n') : t('perm.emptyFile')}</${Text}>
      </${Box}>
    `;
  }
  return html`<${Box} paddingX=${2} paddingY=${1}><${Text}>${JSON.stringify(input, null, 2)}</${Text}></${Box}>`;
}

/** Claude-style approval prompt: Yes / Yes, don't ask again / No (esc). */
export function PermissionDialog({ req, columns, onAnswer }) {
  const [sel, setSel] = useState(0);
  const { title, question } = describe(req);
  const options = [
    { value: 'yes', label: t('perm.yes') },
    { value: 'always', label: req.always.label, hint: req.always.hint },
    { value: 'no', label: t('perm.no', { name: MASCOT_NAME }), hint: 'esc' },
  ];

  useInput((input, key) => {
    if (key.upArrow) setSel((s) => (s + options.length - 1) % options.length);
    else if (key.downArrow || (key.tab && !key.shift)) setSel((s) => (s + 1) % options.length);
    else if (key.return) onAnswer(options[sel].value);
    else if (key.escape) onAnswer('no');
    else if (key.tab && key.shift && req.tool.isEdit) onAnswer('always');
    else if (/^[1-3]$/.test(input)) onAnswer(options[Number(input) - 1].value);
  });

  return html`
    <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.permission} paddingX=${1} marginTop=${1} width=${columns}>
      <${Text} bold color=${theme.permission}>${title}</${Text}>
      <${Body} req=${req} columns=${columns} />
      <${Text}>${question}</${Text}>
      ${options.map(
        (o, i) => html`
          <${Text} key=${o.value}>
            <${Text} color=${theme.permission}>${i === sel ? '❯ ' : '  '}</${Text}>
            <${Text} color=${i === sel ? theme.permission : undefined}>${i + 1}. ${o.label}</${Text}>
            ${o.hint ? html`<${Text} dimColor> (${o.hint})</${Text}>` : ''}
          </${Text}>
        `,
      )}
    </${Box}>
  `;
}
