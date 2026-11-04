import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { html } from './h.js';
import { theme } from '../theme.js';
import { t } from '../i18n.js';

// Each running agent cycles the same star glyphs, out of phase with its neighbours.
const STAR = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const ORBIT = ['◐', '◓', '◑', '◒'];

export const fmtElapsed = (ms) => {
  if (ms == null || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function symbol(status, frame, offset, orbit = false) {
  switch (status) {
    case 'done':
      return { ch: '✔', color: theme.success };
    case 'failed':
      return { ch: '✘', color: theme.error };
    case 'cancelled':
      return { ch: '⊘', color: theme.inactive };
    case 'queued':
      return { ch: '◌', color: theme.inactive };
    default: {
      const set = orbit ? ORBIT : STAR;
      return { ch: set[(frame + offset) % set.length], color: orbit ? theme.permission : theme.brand };
    }
  }
}

const statusColor = (status) =>
  status === 'done' ? theme.success : status === 'failed' ? theme.error : status === 'running' ? theme.brand : theme.inactive;

/**
 * The orchestrator and every subagent, one row each:
 *   symbol · model · what it is doing · status · elapsed
 * Live while the run is going (`final` false); frozen in the transcript afterwards.
 */
export function AgentsPanel({ snapshot, columns, final = false }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (final) return;
    const timer = setInterval(() => setFrame((f) => f + 1), 120);
    return () => clearInterval(timer);
  }, [final]);

  const now = snapshot.endedAt ?? Date.now();
  const o = snapshot.orchestrator;
  const rows = [
    {
      key: 'orch',
      label: `${t('orch.orchestrator')} · ${o.model}`,
      activity: o.activity,
      status: o.status,
      elapsed: now - snapshot.startedAt,
      orbit: true,
      offset: 0,
    },
    ...snapshot.agents.map((a, i) => ({
      key: a.id,
      label: `#${a.n} · ${a.model}`,
      activity: a.status === 'queued' ? a.name : a.activity,
      status: a.status,
      elapsed: a.startedAt ? (a.endedAt ?? now) - a.startedAt : null,
      offset: (i + 1) * 3,
    })),
  ];

  const labelW = Math.min(36, Math.max(...rows.map((r) => r.label.length)) + 2);
  const statusW = Math.max(...['running', 'queued', 'done', 'failed', 'cancelled'].map((s) => t(`orch.status.${s}`).length)) + 2;

  return html`
    <${Box} flexDirection="column" marginTop=${1} width=${columns}>
      ${rows.map((r) => {
        const s = symbol(r.status, frame, r.offset, r.orbit);
        return html`
          <${Box} key=${r.key} flexDirection="row">
            <${Box} width=${2} flexShrink=${0}><${Text} color=${s.color}>${s.ch}</${Text}></${Box}>
            <${Box} width=${labelW} flexShrink=${0}><${Text} bold=${r.orbit} wrap="truncate-end">${r.label}</${Text}></${Box}>
            <${Box} flexGrow=${1} flexShrink=${1} marginRight=${1}><${Text} dimColor wrap="truncate-end">${r.activity || ''}</${Text}></${Box}>
            <${Box} width=${statusW} flexShrink=${0}><${Text} color=${statusColor(r.status)}>${t(`orch.status.${r.status}`)}</${Text}></${Box}>
            <${Box} width=${6} flexShrink=${0} justifyContent="flex-end"><${Text} dimColor>${fmtElapsed(r.elapsed)}</${Text}></${Box}>
          </${Box}>
        `;
      })}
    </${Box}>
  `;
}
