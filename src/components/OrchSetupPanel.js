import React, { useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import chalk from 'chalk';
import { html } from './h.js';
import { theme } from '../theme.js';
import { tildify } from '../utils/paths.js';
import { activeProfile, getProfiles } from '../utils/profiles.js';
import { CATALOG, FAMILIES, fmtContext, UNRELIABLE_UPTIME } from '../orch/catalog.js';
import { orchConfig, saveOrchConfig, ORCH_PATH } from '../orch/config.js';
import { t } from '../i18n.js';

const REASONING = ['', 'low', 'medium', 'high', 'xhigh'];

/** Rows of the panel: section headers and selectable entries. */
function buildRows() {
  const rows = [{ section: 'orchestrator' }, { kind: 'orchestrator' }, { section: 'routing' }];
  for (const family of Object.keys(FAMILIES)) rows.push({ kind: 'route', family });
  rows.push({ section: 'limits' }, { kind: 'maxParallel' }, { kind: 'agentReasoning' }, { section: 'models' });
  for (const family of Object.keys(FAMILIES)) {
    rows.push({ family: FAMILIES[family].label, subheader: true });
    for (const m of CATALOG.filter((x) => x.family === family)) rows.push({ kind: 'model', model: m });
  }
  return rows;
}

const ROWS = buildRows();
const SELECTABLE = ROWS.map((r, i) => (r.kind ? i : -1)).filter((i) => i >= 0);

const cycle = (list, value, dir) => list[(list.indexOf(value) + dir + list.length) % list.length];

const modelStats = (m) =>
  [m.cost == null ? '×?' : `×${m.cost}`, m.quality == null ? '—' : `${m.quality}%`, m.uptime == null ? '?' : `${m.uptime}%`, fmtContext(m.context)].join(' · ');

/**
 * /orch-setup: pick the orchestrator, route each provider family through a profile,
 * set limits, and choose which models subagents may use. Saves as you go.
 */
export function OrchSetupPanel({ columns, onClose }) {
  const { stdout } = useStdout();
  const [cursor, setCursor] = useState(0);
  const [, force] = useState(0);
  const initial = useRef(JSON.stringify(orchConfig));

  const row = ROWS[SELECTABLE[cursor]];
  const profileIds = ['', ...getProfiles().map((p) => p.id)];
  const modelIds = CATALOG.map((m) => m.id);

  const change = (patch) => {
    saveOrchConfig(patch);
    force((x) => x + 1);
  };

  const toggleModel = (id) => {
    const on = orchConfig.enabled.includes(id);
    change({ enabled: on ? orchConfig.enabled.filter((x) => x !== id) : [...orchConfig.enabled, id] });
  };

  const adjust = (dir) => {
    switch (row.kind) {
      case 'orchestrator':
        return change({ orchestrator: cycle(modelIds, orchConfig.orchestrator, dir) });
      case 'route':
        return change({ routes: { ...orchConfig.routes, [row.family]: cycle(profileIds, orchConfig.routes[row.family] ?? '', dir) } });
      case 'maxParallel':
        return change({ maxParallel: Math.min(8, Math.max(1, orchConfig.maxParallel + dir)) });
      case 'agentReasoning':
        return change({ agentReasoning: cycle(REASONING, orchConfig.agentReasoning, dir) });
      case 'model':
        return toggleModel(row.model.id);
    }
  };

  const close = () => onClose(JSON.stringify(orchConfig) !== initial.current);

  useInput((input, key) => {
    if (key.escape || input === 'q' || (key.ctrl && input === 'c')) return close();
    if (key.upArrow || input === 'k') return setCursor((c) => (c + SELECTABLE.length - 1) % SELECTABLE.length);
    if (key.downArrow || input === 'j' || key.tab) return setCursor((c) => (c + 1) % SELECTABLE.length);
    if (key.pageDown) return setCursor((c) => Math.min(SELECTABLE.length - 1, c + 10));
    if (key.pageUp) return setCursor((c) => Math.max(0, c - 10));
    if (input === 'a') return change({ enabled: CATALOG.map((m) => m.id) });
    if (input === 'n') return change({ enabled: [] });
    if (key.leftArrow || input === 'h') return adjust(-1);
    if (key.rightArrow || input === 'l' || key.return || input === ' ') return adjust(1);
  });

  // Scroll so the panel fits the terminal.
  const maxRows = Math.max(10, (stdout.rows || 40) - 10);
  const selRow = SELECTABLE[cursor];
  let start = 0;
  if (ROWS.length > maxRows) start = Math.min(Math.max(0, selRow - Math.floor(maxRows / 2)), ROWS.length - maxRows);
  const visible = ROWS.slice(start, start + maxRows);
  const labelW = 30;

  const value = (r, active) => {
    const arrows = (s) => (active ? `‹ ${s} ›` : `  ${s}`);
    switch (r.kind) {
      case 'orchestrator':
        return arrows(orchConfig.orchestrator);
      case 'route': {
        const id = orchConfig.routes[r.family] ?? '';
        const p = id ? getProfiles().find((x) => x.id === id) : null;
        return arrows(p ? `${p.name} (${p.type})` : t('setup.activeProfile', { name: activeProfile().name }));
      }
      case 'maxParallel':
        return arrows(String(orchConfig.maxParallel));
      case 'agentReasoning':
        return arrows(orchConfig.agentReasoning || t('setup.reasoningDefault'));
      default:
        return '';
    }
  };

  const enabledCount = orchConfig.enabled.length;

  return html`
    <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.permission} paddingX=${1} marginTop=${1} width=${columns}>
      <${Text} bold color=${theme.permission}>${t('setup.title')}</${Text}>
      <${Text} dimColor>${t('setup.subtitle', { path: tildify(ORCH_PATH) })}</${Text}>
      <${Box} flexDirection="column" marginTop=${1}>
        ${start > 0 && html`<${Text} dimColor>  ↑</${Text}>`}
        ${visible.map((r, i) => {
          const idx = start + i;
          if (r.section) {
            const extra = r.section === 'models' ? chalk.dim(`  ${t('setup.enabledCount', { n: enabledCount, total: CATALOG.length })} · ${t('setup.modelsHint')}`) : '';
            return html`<${Box} key=${'s' + idx} marginTop=${i === 0 ? 0 : 1}><${Text} bold dimColor>${t(`setup.section.${r.section}`)}</${Text}><${Text}>${extra}</${Text}></${Box}>`;
          }
          if (r.subheader) return html`<${Text} key=${'h' + idx} color=${theme.brand}>  ${r.family}</${Text}>`;
          const active = idx === selRow;
          const pointer = active ? '❯ ' : '  ';
          if (r.kind === 'model') {
            const m = r.model;
            const on = orchConfig.enabled.includes(m.id);
            const warn = m.uptime != null && m.uptime < UNRELIABLE_UPTIME ? chalk.hex(theme.warning)(' ⚠') : '';
            const isOrch = orchConfig.orchestrator === m.id ? chalk.hex(theme.permission)(` ◆ ${t('orch.orchestrator')}`) : '';
            return html`
              <${Box} key=${m.id} flexDirection="row">
                <${Box} width=${labelW} flexShrink=${0}>
                  <${Text} color=${active ? theme.suggestion : undefined}>${pointer}<${Text} color=${on ? theme.success : theme.inactive}>${on ? '☒' : '☐'}</${Text}> ${m.id}</${Text}>
                </${Box}>
                <${Text} dimColor wrap="truncate-end">${modelStats(m)}${warn}${isOrch}</${Text}>
              </${Box}>
            `;
          }
          const label = r.kind === 'route' ? FAMILIES[r.family].label : t(`setup.${r.kind}`);
          return html`
            <${Box} key=${r.kind + (r.family ?? '')} flexDirection="row">
              <${Box} width=${labelW} flexShrink=${0}><${Text} color=${active ? theme.suggestion : undefined}>${pointer}${label}</${Text}></${Box}>
              <${Text} color=${active ? theme.suggestion : undefined} wrap="truncate-end">${value(r, active)}</${Text}>
            </${Box}>
          `;
        })}
        ${start + maxRows < ROWS.length && html`<${Text} dimColor>  ↓</${Text}>`}
      </${Box}>
      <${Box} marginTop=${1}><${Text} dimColor>${t('setup.hint')}</${Text}></${Box}>
    </${Box}>
  `;
}
