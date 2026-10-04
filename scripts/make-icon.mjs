// Draws the ZeroCli app icon from Zero-chan's pixel sprite (src/mascot.js):
// the sprite sits on a rounded night-sky tile with a soft coral glow.
// Writes assets/ZeroCli.ico (16–256 px, PNG-compressed) and assets/ZeroCli.png (256 px preview).
//
// Usage: node scripts/make-icon.mjs   (also run by scripts/build-exe.mjs)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { IDLE, PALETTE } from '../src/mascot.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [256, 128, 64, 48, 32, 24, 16];

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const TOP = hex('#3B2A55');
const BOTTOM = hex('#151024');
const GLOW = hex('#E8825E');
const RIM = hex('#E8825E');

// ---- PNG encoding ---------------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- drawing --------------------------------------------------------------
/** Coverage (0..1) of a rounded square of side `size` and corner radius `r` at pixel (x, y), 4x4 supersampled. */
function tileCoverage(x, y, size, r) {
  let hit = 0;
  for (let sy = 0; sy < 4; sy++)
    for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4;
      const py = y + (sy + 0.5) / 4;
      const dx = Math.max(r - px, px - (size - r), 0);
      const dy = Math.max(r - py, py - (size - r), 0);
      if (dx * dx + dy * dy <= r * r) hit++;
    }
  return hit / 16;
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  // Tiny icons: the sprite fills the tile so every pixel of the face stays readable.
  const scale = size <= 32 ? Math.floor(size / 16) : Math.floor((size * 0.78) / 16);
  const spriteW = 16 * scale;
  const ox = Math.floor((size - spriteW) / 2);
  const oy = size <= 32 ? size - spriteW : Math.round(size - spriteW - size * 0.02);
  const radius = size * 0.22;
  const rimW = Math.max(1, size / 64);

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const cov = tileCoverage(x, y, size, radius);
      if (!cov) continue;
      // background: vertical gradient + warm glow behind the head
      let c = mix(TOP, BOTTOM, y / size);
      const gx = (x + 0.5 - size / 2) / size;
      const gy = (y + 0.5 - size * 0.45) / size;
      const glow = Math.max(0, 1 - Math.sqrt(gx * gx + gy * gy) / 0.42);
      c = mix(c, GLOW, glow * glow * 0.45);
      // thin coral rim just inside the edge
      if (size >= 48 && tileCoverage(x, y, size, radius) === 1) {
        const inner = (() => {
          const ix = x - rimW, iy = y - rimW, s = size - 2 * rimW;
          return ix >= 0 && iy >= 0 && ix < s && iy < s ? tileCoverage(ix, iy, s, radius - rimW) : 0;
        })();
        c = mix(c, RIM, (1 - inner) * 0.85);
      }
      // sprite on top (hard pixel edges)
      const sx = Math.floor((x - ox) / scale);
      const sy = Math.floor((y - oy) / scale);
      const ch = sx >= 0 && sy >= 0 && sx < 16 && sy < 16 ? IDLE[sy][sx] : '.';
      if (ch !== '.') c = hex(PALETTE[ch]);
      const i = (y * size + x) * 4;
      px[i] = Math.round(c[0]);
      px[i + 1] = Math.round(c[1]);
      px[i + 2] = Math.round(c[2]);
      px[i + 3] = Math.round(cov * 255);
    }
  return encodePng(size, px);
}

// ---- ICO container --------------------------------------------------------
export function makeIcon() {
  const dir = path.join(root, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const pngs = SIZES.map(draw);
  const header = Buffer.alloc(6 + 16 * SIZES.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(SIZES.length, 4);
  let offset = header.length;
  SIZES.forEach((s, i) => {
    const e = 6 + i * 16;
    header[e] = s >= 256 ? 0 : s;
    header[e + 1] = s >= 256 ? 0 : s;
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bpp
    header.writeUInt32LE(pngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  const ico = path.join(dir, 'ZeroCli.ico');
  fs.writeFileSync(ico, Buffer.concat([header, ...pngs]));
  fs.writeFileSync(path.join(dir, 'ZeroCli.png'), pngs[0]);
  return ico;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Wrote ${path.relative(root, makeIcon())}`);
}
