// Builds a standalone executable (no Node.js needed to run it):
//   1. esbuild bundles the whole app into dist/zero.mjs
//   2. Node's Single Executable Application support packs that bundle (as an asset)
//      plus scripts/sea-main.cjs into a blob
//   3. on Windows, the ZeroCli icon and version info are stamped onto a copy of the node binary
//   4. the blob is injected into that copy -> dist/ZeroCli(.exe)
//
// Usage: npm run build
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeIcon } from './make-icon.mjs';
import { VERSION } from '../src/theme.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const isWin = process.platform === 'win32';
let exe = path.join(dist, isWin ? 'ZeroCli.exe' : 'ZeroCli');
const bundle = path.join(dist, 'zero.mjs');
const blob = path.join(dist, 'sea-prep.blob');
const seaConfig = path.join(dist, 'sea-config.json');

const step = (msg) => console.log(`\x1b[38;2;215;119;87m✻\x1b[0m ${msg}`);

fs.mkdirSync(dist, { recursive: true });

step('Bundling with esbuild…');
await build({
  entryPoints: [path.join(root, 'bin', 'zero.js')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: bundle,
  alias: { 'react-devtools-core': path.join(root, 'scripts', 'stubs', 'react-devtools-core.js') },
  define: { 'process.env.NODE_ENV': '"production"' },
  // Some dependencies still call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __zcr } from 'node:module'; const require = __zcr(import.meta.url);" },
  logLevel: 'warning',
});

step('Creating the SEA blob…');
fs.writeFileSync(
  seaConfig,
  JSON.stringify({
    main: path.join(root, 'scripts', 'sea-main.cjs'),
    output: blob,
    disableExperimentalSEAWarning: true,
    assets: { 'zero.mjs': bundle },
  }),
);
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

try {
  fs.rmSync(exe, { force: true });
} catch (e) {
  // Windows locks a running .exe; build next to it instead of failing.
  if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e;
  exe = path.join(dist, isWin ? 'ZeroCli-new.exe' : 'ZeroCli-new');
  console.warn(`  ${path.basename(exe).replace('-new', '')} is running, so this build goes to ${path.relative(root, exe)}. Close Zero Code and rename it to replace the old one.`);
  fs.rmSync(exe, { force: true });
}
step(`Copying ${path.basename(process.execPath)} → ${path.relative(root, exe)}…`);
fs.copyFileSync(process.execPath, exe);

if (isWin) {
  // Resources must be edited before the SEA blob goes in, or rcedit would drop it.
  step('Stamping the icon and version info…');
  const rcedit = path.join(root, 'node_modules', 'rcedit', 'bin', process.arch === 'x64' ? 'rcedit-x64.exe' : 'rcedit.exe');
  const strings = {
    FileDescription: 'ZeroCli - agentic coding assistant with Zero-chan',
    ProductName: 'ZeroCli',
    CompanyName: 'ZeroCli',
    LegalCopyright: `Copyright (c) ${new Date().getFullYear()} ZeroCli. MIT License.`,
    OriginalFilename: 'ZeroCli.exe',
    InternalName: 'ZeroCli',
    Comments: 'An agentic coding CLI for your terminal, with a pixel anime mascot.',
  };
  execFileSync(rcedit, [
    exe,
    '--set-icon', makeIcon(),
    '--set-file-version', `${VERSION}.0`,
    '--set-product-version', VERSION,
    ...Object.entries(strings).flatMap(([k, v]) => ['--set-version-string', k, v]),
  ], { stdio: 'inherit' });
}

step('Injecting the app…');
const postject = path.join(root, 'node_modules', 'postject', 'dist', 'cli.js');
const args = [postject, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA');
execFileSync(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', exe]);

for (const f of [blob, seaConfig]) fs.rmSync(f, { force: true });

const mb = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
step(`Done: ${path.relative(root, exe)} (${mb} MB)`);
