import chalk from 'chalk';

// Zero-chan: a 16x16 pixel sprite rendered with half-block characters,
// so every terminal row holds two pixel rows (top = fg of ▀, bottom = bg).
//
// Legend
//   .  transparent        H  hair            D  hair shade     h  hair shine
//   S  skin               s  skin shade      L  lashes         I  iris
//   W  eye glint          B  blush           M  mouth
//   R  ribbon             r  ribbon shade    N  sailor collar  C  uniform
export const PALETTE = {
  H: '#E8825E',
  D: '#A8503A',
  h: '#FFB892',
  S: '#FFE3D3',
  s: '#EBC0A8',
  L: '#2A1A3A',
  I: '#8A6CFF',
  W: '#FFFFFF',
  B: '#FF9AA2',
  M: '#E07A85',
  R: '#E5394F',
  r: '#A82035',
  N: '#2F3F7A',
  C: '#F4F4F8',
};

export const HAIR_COLORS = {
  coral: { H: '#E8825E', D: '#A8503A', h: '#FFB892' },
  sakura: { H: '#F48FB1', D: '#C2577F', h: '#FFD1E3' },
  sky: { H: '#6FA8FF', D: '#3A63B8', h: '#BFD9FF' },
  lavender: { H: '#B48CFF', D: '#7651C9', h: '#E0CCFF' },
  mint: { H: '#5FD3B0', D: '#2E8F74', h: '#B8F2E0' },
  silver: { H: '#C9CCD6', D: '#8A8F9E', h: '#F2F3F7' },
  midnight: { H: '#3A3F5C', D: '#1F2236', h: '#6B7299' },
};

export const EYE_COLORS = {
  violet: '#8A6CFF',
  emerald: '#2FBF71',
  ruby: '#E0475B',
  gold: '#E6B422',
  ocean: '#4AA8FF',
};

/** Recolor Zero-chan; cached frames are thrown away so the next render uses the new palette. */
export function setMascotColors({ hair, eyes } = {}) {
  if (HAIR_COLORS[hair]) Object.assign(PALETTE, HAIR_COLORS[hair]);
  if (EYE_COLORS[eyes]) PALETTE.I = EYE_COLORS[eyes];
  cache.clear();
}

export const IDLE = [
  '.....DHHHHD.....',
  '...DHHHhhHHHD...',
  '..DHHHHHHhHHHD..',
  '.DHHHHHHHHHHHHD.',
  'RDHHDHHHHHHDHHDR',
  'RRHDSHDSSDHSDHRR',
  '.DHSSSSSSSSSSHD.',
  'DHHSLLSSSSLLSHHD',
  'DHDSIWSSSSWISDHD',
  'DH.SIISSSSIIS.HD',
  'DH..BSSSSSSB..HD',
  'DH...sSMMSs...HD',
  '.D....sSSs....D.',
  '.D..NNCSSCNN..D.',
  '...NNCCRRCCNN...',
  '..CCCCCrRrCCCC..',
];

const withRows = (base, patch) => base.map((row, i) => patch[i] ?? row);

const BLINK = withRows(IDLE, {
  7: 'DHHSSSSSSSSSSHHD',
  8: 'DHDSLLSSSSLLSDHD',
  9: 'DH.SSSSSSSSSS.HD',
});

// ^ ^ happy eyes, used when a turn finishes successfully
const HAPPY = withRows(IDLE, {
  7: 'DHHSSLSSSSLSSHHD',
  8: 'DHDSLSLSSLSLSDHD',
  9: 'DH.SSSSSSSSSS.HD',
});

// o o surprised, used for errors / interrupts
const SURPRISED = withRows(IDLE, {
  8: 'DHDSIISSSSIISDHD',
  11: 'DH...sSLLSs...HD',
});

export const FRAMES = { idle: IDLE, blink: BLINK, happy: HAPPY, surprised: SURPRISED };

const cache = new Map();

/** Render a sprite to an array of ANSI strings (8 terminal rows for 16 pixel rows). */
export function renderSprite(name = 'idle') {
  if (cache.has(name)) return cache.get(name);
  const rows = FRAMES[name] ?? IDLE;
  const out = [];
  for (let y = 0; y < rows.length; y += 2) {
    const top = rows[y];
    const bottom = rows[y + 1] ?? '.'.repeat(top.length);
    let line = '';
    for (let x = 0; x < top.length; x++) {
      const t = PALETTE[top[x]];
      const b = PALETTE[bottom[x]];
      if (t && b) line += chalk.hex(t).bgHex(b)('▀');
      else if (t) line += chalk.hex(t)('▀');
      else if (b) line += chalk.hex(b)('▄');
      else line += ' ';
    }
    out.push(line);
  }
  cache.set(name, out);
  return out;
}

export const SPRITE_WIDTH = IDLE[0].length;
export const SPRITE_HEIGHT = IDLE.length / 2;
