import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Box, Text } from 'ink';
import { html } from './h.js';
import { theme, APP_NAME, VERSION } from '../theme.js';
import { renderSprite } from '../mascot.js';
import { tildify } from '../utils/paths.js';
import { loadHistory, MEMORY_FILE } from '../utils/config.js';
import { t, timeAgo } from '../i18n.js';
import { renderInline } from './markdown.js';
import { settings } from '../utils/settings.js';

function username() {
  if (settings.displayName) return settings.displayName;
  try {
    const n = os.userInfo().username;
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : '';
  } catch {
    return '';
  }
}

function recentActivity(cwd) {
  return loadHistory()
    .filter((h) => h.cwd === cwd && !h.text.startsWith('/'))
    .slice(-3)
    .reverse();
}

const greeting = (name) => (name ? t('welcome.back', { name }) : t('welcome.plain'));

const truncate = (s, n) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s);

/** The bordered welcome banner, modelled on Claude Code's two-column welcome screen. */
export function Welcome({ columns, cwd, model }) {
  const width = Math.max(40, columns);
  const name = username();
  const sprite = renderSprite('idle');
  const title = ` ${APP_NAME} `;
  const ver = `v${VERSION} `;
  const topRule = '─'.repeat(Math.max(0, width - 5 - title.length - ver.length));
  const location = tildify(cwd);

  // Narrow terminals get the compact single-column card.
  if (width < 76) {
    return html`
      <${Box} flexDirection="column" width=${width}>
        <${Text} color=${theme.brand}>╭───<${Text} color=${theme.brand}>${title}</${Text}><${Text} dimColor>${ver}</${Text}>${topRule}╮</${Text}>
        <${Box} borderStyle="round" borderTop=${false} borderColor=${theme.brand} flexDirection="column" alignItems="center" paddingX=${1}>
          <${Text} bold>${greeting(name)}</${Text}>
          <${Text}> </${Text}>
          ${sprite.map((l, i) => html`<${Text} key=${i}>${l}</${Text}>`)}
          <${Text}> </${Text}>
          <${Text} dimColor>${truncate(`${model.label} · ${model.description}`, width - 6)}</${Text}>
          <${Text} dimColor>${truncate(location, width - 6)}</${Text}>
        </${Box}>
      </${Box}>
    `;
  }

  const inner = width - 4;
  const leftW = Math.max(30, Math.floor(inner * 0.42));
  const rightW = inner - leftW - 3;
  const hasMemory = fs.existsSync(path.join(cwd, MEMORY_FILE));
  const recent = recentActivity(cwd);

  return html`
    <${Box} flexDirection="column" width=${width}>
      <${Text} color=${theme.brand}>╭───<${Text} color=${theme.brand}>${title}</${Text}><${Text} dimColor>${ver}</${Text}>${topRule}╮</${Text}>
      <${Box} borderStyle="round" borderTop=${false} borderColor=${theme.brand} paddingX=${1}>
        <${Box} width=${leftW} flexDirection="column" alignItems="center">
          <${Text}> </${Text}>
          <${Text} bold>${greeting(name)}</${Text}>
          <${Text}> </${Text}>
          ${sprite.map((l, i) => html`<${Text} key=${i}>${l}</${Text}>`)}
          <${Text}> </${Text}>
          <${Text} dimColor>${truncate(`${model.label} · ${model.description}`, leftW)}</${Text}>
          <${Text} dimColor>${truncate(location, leftW)}</${Text}>
        </${Box}>
        <${Box}
          width=${rightW + 3}
          flexDirection="column"
          borderStyle="single"
          borderColor=${theme.brand}
          borderTop=${false}
          borderBottom=${false}
          borderRight=${false}
          paddingLeft=${1}
        >
          <${Text} bold color=${theme.brand}>${t('welcome.tipsTitle')}</${Text}>
          ${hasMemory
            ? html`<${Text}>${renderInline(t('welcome.tipExplore'))}</${Text}>`
            : html`<${Text}>${renderInline(t('welcome.tipInit', { file: MEMORY_FILE }))}</${Text}>`}
          <${Text}>${renderInline(t('welcome.tipPrefixes'))}</${Text}>
          <${Text} color=${theme.brand}>${'─'.repeat(Math.max(0, rightW - 1))}</${Text}>
          <${Text} bold color=${theme.brand}>${t('welcome.recentTitle')}</${Text}>
          ${recent.length
            ? recent.map(
                (r, i) =>
                  html`<${Text} key=${i} wrap="truncate-end"><${Text} dimColor>${timeAgo(r.time).padEnd(12)}</${Text}>${r.text.split('\n')[0]}</${Text}>`,
              )
            : html`<${Text} dimColor>${t('welcome.noRecent')}</${Text}>`}
        </${Box}>
      </${Box}>
    </${Box}>
  `;
}
