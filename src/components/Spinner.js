import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { html } from './h.js';
import { theme } from '../theme.js';
import { t, fmtTokens } from '../i18n.js';

const GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽'];
const FRAMES = [...GLYPHS, ...[...GLYPHS].reverse()];

// Read at call time so the current language is used.
export const getVerbs = () => t('spinner.verbs');
export const getTips = () => t('spinner.tips');

function shimmer(text, pos) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const d = Math.abs(i - pos);
    out += d <= 1 ? chalk.hex(theme.brandShimmer)(text[i]) : chalk.hex(theme.brand)(text[i]);
  }
  return out;
}

/** "✻ Pondering… (esc to interrupt · 4s · ↓ 120 tokens)" */
export function Spinner({ verb, startedAt, tokens, tip, label, chatTokens = 0 }) {
  const [frame, setFrame] = useState(0);
  const [, force] = useState(0);
  const shownTokens = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => f + 1);
      // ease the token counter towards the real value, like the real thing
      const diff = tokens - shownTokens.current;
      if (diff > 0) shownTokens.current += Math.max(1, Math.ceil(diff / 4));
      force((x) => x + 1);
    }, 120);
    return () => clearInterval(timer);
  }, [tokens]);

  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const text = `${label ?? verb}…`;
  const glyph = FRAMES[frame % FRAMES.length];
  const pos = (frame % (text.length + 8)) - 4;
  const parts = [t('spinner.escToInterrupt')];
  if (elapsed > 0) parts.push(`${elapsed}s`);
  if (shownTokens.current > 0) parts.push(t('spinner.tokens', { n: fmtTokens(shownTokens.current) }));

  return html`
    <${Box} flexDirection="column" marginTop=${1}>
      <${Box} flexDirection="row">
        <${Box} width=${2} flexShrink=${0}><${Text} color=${theme.brand}>${glyph}</${Text}></${Box}>
        <${Text}>${shimmer(text, pos)} <${Text} dimColor>(${parts.join(' · ')})</${Text}></${Text}>
      </${Box}>
      <${Text} dimColor>  ⎿  ${t('tokens.chat', { n: fmtTokens(chatTokens + shownTokens.current), raw: chatTokens + shownTokens.current })}${tip ? ` · ${t('spinner.tip', { tip })}` : ''}</${Text}>
    </${Box}>
  `;
}
