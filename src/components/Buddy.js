import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { html } from './h.js';
import { theme } from '../theme.js';
import { renderSprite, SPRITE_WIDTH } from '../mascot.js';

export const BUDDY_WIDTH = SPRITE_WIDTH + 2;
export const BUBBLE_WIDTH = 22;

/**
 * Zero-chan sitting next to the prompt. She blinks every few seconds,
 * bobs while working, and changes expression with `mood`.
 */
export function Buddy({ mood = 'idle', speech, busy }) {
  const [blink, setBlink] = useState(false);
  const [bob, setBob] = useState(false);

  useEffect(() => {
    let t;
    const schedule = () => {
      t = setTimeout(() => {
        setBlink(true);
        t = setTimeout(() => {
          setBlink(false);
          schedule();
        }, 160);
      }, 2500 + Math.random() * 3500);
    };
    schedule();
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!busy) return setBob(false);
    const t = setInterval(() => setBob((b) => !b), 450);
    return () => clearInterval(t);
  }, [busy]);

  const frame = mood !== 'idle' ? mood : blink ? 'blink' : 'idle';
  const sprite = renderSprite(frame);

  return html`
    <${Box} flexDirection="row" alignItems="flex-start" flexShrink=${0}>
      ${speech
        ? html`<${Box} width=${BUBBLE_WIDTH} flexDirection="column" alignItems="flex-end" marginTop=${1}>
            <${Box} borderStyle="round" borderColor=${theme.brand} paddingX=${1}>
              <${Text} wrap="wrap">${speech}</${Text}>
            </${Box}>
            <${Text} color=${theme.brand}>╲ </${Text}>
          </${Box}>`
        : null}
      <${Box} flexDirection="column" width=${BUDDY_WIDTH} paddingLeft=${1} paddingTop=${bob ? 0 : 1} paddingBottom=${bob ? 1 : 0}>
        ${sprite.map((l, i) => html`<${Text} key=${i}>${l}</${Text}>`)}
      </${Box}>
    </${Box}>
  `;
}
