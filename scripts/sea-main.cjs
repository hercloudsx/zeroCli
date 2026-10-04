// Entry point of the standalone zero.exe (a Node Single Executable Application).
//
// Node's SEA can only start CommonJS, but the app is an ES module (Ink uses top-level
// await), so the bundle is embedded as an asset. On first run it is unpacked to a
// per-version cache folder and imported from there; later runs reuse the cached copy.
const { getAsset } = require('node:sea');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const code = getAsset('zero.mjs', 'utf8');
const hash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
const dir = path.join(os.homedir(), '.zero', 'runtime');
const file = path.join(dir, `zero-${hash}.mjs`);

if (!fs.existsSync(file)) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, code);
  fs.renameSync(tmp, file);
  // Drop bundles left behind by older versions.
  for (const f of fs.readdirSync(dir)) {
    if (/^zero-[0-9a-f]{16}\.mjs$/.test(f) && f !== path.basename(file)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch {}
    }
  }
}

import(pathToFileURL(file).href).catch((err) => {
  console.error(err);
  process.exit(1);
});
