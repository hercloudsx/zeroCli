import React, { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import { html } from './h.js';
import { theme } from '../theme.js';
import { tildify } from '../utils/paths.js';
import {
  getProfiles,
  getProfile,
  activeProfile,
  setActiveProfile,
  saveProfile,
  removeProfile,
  PRESETS,
  PROFILE_TYPES,
  EFFORTS,
  PROFILES_PATH,
  maskKey,
  hostOf,
} from '../utils/profiles.js';
import { createProvider } from '../providers/index.js';
import { t } from '../i18n.js';

const fieldsFor = (type) => ['name', 'type', 'baseUrl', 'model', 'apiKey', ...(type === 'anthropic' ? ['effort', 'maxTokens'] : []), 'save', 'cancel'];
const TEXT_FIELDS = ['name', 'baseUrl', 'model', 'apiKey', 'maxTokens'];

/** Send a tiny request through a profile and report how it went. */
async function testProfile(profile) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    let reply = '';
    const stream = createProvider(profile).stream({
      system: 'You are a connection test. Reply with just: OK',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with just: OK' }] }],
      tools: [],
      signal: ac.signal,
    });
    for await (const ev of stream) {
      if (ev.type === 'text_delta') reply += ev.text;
      if (ev.type === 'final_blocks' && !reply) reply = ev.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
    }
    return { ok: true, ms: Date.now() - started, reply: reply.trim().replace(/\s+/g, ' ').slice(0, 60) || '(empty)' };
  } catch (e) {
    return { ok: false, msg: ac.signal.aborted ? 'timed out after 30 s' : String(e.message || e).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/** Profile manager, in the style of the settings panel. */
export function ProfilesPanel({ columns, onClose }) {
  const [mode, setMode] = useState('list'); // list | preset | form
  const [cursor, setCursor] = useState(() => Math.max(0, getProfiles().findIndex((p) => p.id === activeProfile().id)));
  const [presetCursor, setPresetCursor] = useState(0);
  const [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null); // id of the profile being edited (null = new)
  const [field, setField] = useState(0);
  const [buffer, setBuffer] = useState(null); // text being typed into a field
  // While true the buffer still holds the old value, shown selected: the first keystroke replaces it.
  const [fresh, setFresh] = useState(false);
  const [status, setStatus] = useState(null); // { text, color }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [, force] = useState(0);
  const testing = useRef(false);

  const profiles = getProfiles();
  const selected = profiles[Math.min(cursor, profiles.length - 1)];
  const rerender = () => force((x) => x + 1);
  const say = (text, color) => setStatus({ text, color });

  const startForm = (profile, id) => {
    setDraft({ ...profile, apiKey: '', maxTokens: String(profile.maxTokens || 64000) });
    setEditingId(id);
    setField(0);
    setBuffer(null);
    setMode('form');
    setStatus(null);
  };

  const fields = draft ? fieldsFor(draft.type) : [];
  const currentField = fields[field];

  const saveDraft = () => {
    if (!draft.name.trim()) return say(t('profiles.required', { field: t('profiles.field.name') }), theme.error);
    if (!draft.baseUrl.trim() && draft.type !== 'anthropic') return say(t('profiles.required', { field: t('profiles.field.baseUrl') }), theme.error);
    const existing = editingId ? getProfile(editingId) : null;
    // An empty key field means "keep the stored key".
    const saved = saveProfile({ ...draft, id: editingId || undefined, apiKey: draft.apiKey.trim() || existing?.apiKey || '' });
    setMode('list');
    setCursor(getProfiles().findIndex((p) => p.id === saved.id));
    say(t('profiles.saved', { name: saved.name }), theme.success);
  };

  const runTest = async (profile) => {
    if (testing.current) return;
    testing.current = true;
    say(t('profiles.testing', { name: profile.name }), theme.inactive);
    const r = await testProfile(profile);
    testing.current = false;
    say(r.ok ? t('profiles.testOk', { name: profile.name, ms: r.ms, reply: r.reply }) : t('profiles.testFail', { name: profile.name, msg: r.msg }), r.ok ? theme.success : theme.error);
  };

  useInput((input, key) => {
    // ---- typing into a form field ------------------------------------------
    if (buffer !== null) {
      if (key.escape) return setBuffer(null);
      if (key.return) {
        const value = currentField === 'maxTokens' ? buffer.replace(/\D/g, '') : buffer.trim();
        setDraft((d) => ({ ...d, [currentField]: value }));
        setBuffer(null);
        return setField((f) => Math.min(f + 1, fields.length - 1));
      }
      if (key.backspace || key.delete) {
        if (fresh) {
          setFresh(false);
          return setBuffer('');
        }
        return setBuffer((b) => b.slice(0, -1));
      }
      if (input && !key.ctrl && !key.meta) {
        const typed = input.replace(/[\r\n]/g, '');
        setBuffer((b) => ((fresh ? '' : b) + typed).slice(0, 400));
        setFresh(false);
      }
      return;
    }

    // ---- form ---------------------------------------------------------------
    if (mode === 'form') {
      if (key.escape || (key.ctrl && input === 'c')) return setMode('list');
      if (key.upArrow) return setField((f) => (f + fields.length - 1) % fields.length);
      if (key.downArrow || key.tab) return setField((f) => (f + 1) % fields.length);
      const activate = key.return || input === ' ';
      if (currentField === 'type' && (activate || key.leftArrow || key.rightArrow)) {
        const i = PROFILE_TYPES.indexOf(draft.type);
        const next = PROFILE_TYPES[(i + (key.leftArrow ? -1 : 1) + PROFILE_TYPES.length) % PROFILE_TYPES.length];
        return setDraft((d) => ({ ...d, type: next, baseUrl: d.baseUrl || (next === 'anthropic' ? 'https://api.anthropic.com' : '') }));
      }
      if (currentField === 'effort' && (activate || key.leftArrow || key.rightArrow)) {
        const i = EFFORTS.indexOf(draft.effort || '');
        return setDraft((d) => ({ ...d, effort: EFFORTS[(i + (key.leftArrow ? -1 : 1) + EFFORTS.length) % EFFORTS.length] }));
      }
      if (TEXT_FIELDS.includes(currentField) && activate) {
        // A key is never shown, so it always starts empty; other fields start with their value selected.
        const start = currentField === 'apiKey' ? '' : String(draft[currentField] ?? '');
        setFresh(start !== '');
        return setBuffer(start);
      }
      if (currentField === 'save' && activate) return saveDraft();
      if (currentField === 'cancel' && activate) return setMode('list');
      return;
    }

    // ---- preset picker -------------------------------------------------------
    if (mode === 'preset') {
      if (key.escape) return setMode('list');
      if (key.upArrow) return setPresetCursor((c) => (c + PRESETS.length - 1) % PRESETS.length);
      if (key.downArrow || key.tab) return setPresetCursor((c) => (c + 1) % PRESETS.length);
      if (key.return) {
        const { preset, ...profile } = PRESETS[presetCursor];
        return startForm(profile, null);
      }
      return;
    }

    // ---- list ----------------------------------------------------------------
    if (key.escape || input === 'q' || (key.ctrl && input === 'c')) return onClose();
    if (key.upArrow || input === 'k') {
      setConfirmDelete(null);
      return setCursor((c) => (c + profiles.length - 1) % profiles.length);
    }
    if (key.downArrow || input === 'j' || key.tab) {
      setConfirmDelete(null);
      return setCursor((c) => (c + 1) % profiles.length);
    }
    if (input === 'n') return (setPresetCursor(0), setMode('preset'), setStatus(null));
    if (key.return) {
      setActiveProfile(selected.id);
      rerender();
      return say(t('profiles.switched', { name: selected.name, model: selected.model || '—' }), theme.success);
    }
    if (selected.builtin) return;
    if (input === 'e') return startForm(selected, selected.id);
    if (input === 't') return runTest(selected);
    if (input === 'd') {
      if (confirmDelete === selected.id) {
        removeProfile(selected.id);
        setConfirmDelete(null);
        setCursor((c) => Math.max(0, Math.min(c, getProfiles().length - 1)));
        return say(t('profiles.removed', { name: selected.name }), theme.inactive);
      }
      return setConfirmDelete(selected.id);
    }
  });

  const active = activeProfile().id;
  const labelW = 22;

  // ---------------------------------------------------------------------------
  const frame = (title, body, hint) => html`
    <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.permission} paddingX=${1} marginTop=${1} width=${columns}>
      <${Text} bold color=${theme.permission}>${title}</${Text}>
      <${Text} dimColor>${t('profiles.subtitle', { path: tildify(PROFILES_PATH) })}</${Text}>
      <${Box} flexDirection="column" marginTop=${1}>${body}</${Box}>
      <${Box} flexDirection="column" marginTop=${1}>
        ${status ? html`<${Text} color=${status.color} wrap="truncate-end">${status.text}</${Text}>` : null}
        <${Text} dimColor>${hint}</${Text}>
      </${Box}>
    </${Box}>
  `;

  if (mode === 'preset') {
    return frame(
      t('profiles.presetTitle'),
      PRESETS.map((p, i) => {
        const on = i === presetCursor;
        return html`
          <${Box} key=${p.preset} flexDirection="row">
            <${Box} width=${labelW} flexShrink=${0}><${Text} color=${on ? theme.suggestion : undefined}>${on ? '❯ ' : '  '}${p.name}</${Text}></${Box}>
            <${Text} dimColor>${p.type} · ${hostOf(p.baseUrl) || '—'}${p.model ? ` · ${p.model}` : ''}</${Text}>
          </${Box}>
        `;
      }),
      t('profiles.presetHint'),
    );
  }

  if (mode === 'form') {
    const existing = editingId ? getProfile(editingId) : null;
    const show = (f, on) => {
      if (on && buffer !== null) {
        const shown = f === 'apiKey' ? '•'.repeat(buffer.length) : buffer;
        const text = shown.length > 60 ? '…' + shown.slice(-59) : shown;
        return fresh ? chalk.inverse(text) : chalk.hex(theme.suggestion)(text) + chalk.inverse(' ');
      }
      if (f === 'apiKey') return draft.apiKey ? maskKey(draft.apiKey) : existing?.apiKey ? `${maskKey(existing.apiKey)} ${chalk.dim(t('profiles.keepHint'))}` : t('common.notSet');
      if (f === 'effort') return draft.effort || t('profiles.effortDefault');
      if (f === 'type') return on ? `‹ ${draft.type} ›` : draft.type;
      const v = String(draft[f] ?? '');
      return v === '' ? chalk.dim(f === 'baseUrl' && draft.type === 'anthropic' ? 'https://api.anthropic.com' : t('common.notSet')) : v;
    };
    return frame(
      editingId ? t('profiles.formEdit') : t('profiles.formNew'),
      fields.map((f, i) => {
        const on = i === field;
        if (f === 'save' || f === 'cancel') {
          return html`<${Box} key=${f} marginTop=${f === 'save' ? 1 : 0}><${Text} bold=${on} color=${on ? (f === 'save' ? theme.success : theme.error) : undefined}>${on ? '❯ ' : '  '}${t(`profiles.${f}`)}</${Text}></${Box}>`;
        }
        return html`
          <${Box} key=${f} flexDirection="row">
            <${Box} width=${labelW} flexShrink=${0}><${Text} color=${on ? theme.suggestion : undefined}>${on ? '❯ ' : '  '}${t(`profiles.field.${f}`)}</${Text}></${Box}>
            <${Text}>${show(f, on)}</${Text}>
          </${Box}>
        `;
      }),
      buffer !== null ? t('profiles.editHint') : t('profiles.formHint'),
    );
  }

  return frame(
    t('profiles.title'),
    profiles.map((p, i) => {
      const on = i === cursor;
      const isActive = p.id === active;
      const detail = p.builtin ? t('profiles.offline') : [p.type, p.model || '—', hostOf(p.baseUrl) || '—', p.apiKey ? `${t('profiles.key')} ${maskKey(p.apiKey)}` : t('profiles.noKey')].join(' · ');
      return html`
        <${Box} key=${p.id} flexDirection="row">
          <${Box} width=${4} flexShrink=${0}>
            <${Text} color=${theme.suggestion}>${on ? '❯ ' : '  '}</${Text}>
            <${Text} color=${isActive ? theme.success : theme.subtle}>${isActive ? '●' : '○'}</${Text}>
          </${Box}>
          <${Box} width=${20} flexShrink=${0}><${Text} color=${on ? theme.suggestion : undefined} wrap="truncate-end">${p.name}</${Text}></${Box}>
          <${Text} dimColor wrap="truncate-end">${detail}${isActive ? ` · ${t('profiles.active')}` : ''}</${Text}>
        </${Box}>
      `;
    }),
    confirmDelete ? t('profiles.confirmDelete', { name: selected?.name }) : t('profiles.hint'),
  );
}
