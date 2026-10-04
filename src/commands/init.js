import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { IGNORE_GLOBS, IGNORE_DIRS } from '../utils/paths.js';
import { MEMORY_FILE } from '../utils/config.js';

const LANG_BY_EXT = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript',
  py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', kt: 'Kotlin', rb: 'Ruby', php: 'PHP', cs: 'C#', c: 'C',
  cpp: 'C++', h: 'C/C++', swift: 'Swift', html: 'HTML', css: 'CSS', scss: 'SCSS', vue: 'Vue', svelte: 'Svelte',
  sh: 'Shell', ps1: 'PowerShell', sql: 'SQL', md: 'Markdown',
};

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

/** Build a ZERO.md from a quick static analysis of the project (no model needed). */
export function analyzeProject(cwd) {
  const files = fg.sync('**/*', { cwd: cwd.replace(/\\/g, '/'), dot: false, ignore: IGNORE_GLOBS, suppressErrors: true, deep: 8 }).slice(0, 20000);
  const langs = {};
  for (const f of files) {
    const lang = LANG_BY_EXT[path.extname(f).slice(1).toLowerCase()];
    if (lang) langs[lang] = (langs[lang] ?? 0) + 1;
  }
  const top = fs
    .readdirSync(cwd, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.') && !IGNORE_DIRS.includes(e.name))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));

  const pkg = readJson(path.join(cwd, 'package.json'));
  const out = [`# ${MEMORY_FILE}`, '', 'This file provides guidance to Zero Code (Zero-chan) when working with code in this repository.', ''];

  out.push('## Project overview', '');
  if (pkg) {
    out.push(`- **Name:** ${pkg.name ?? path.basename(cwd)}${pkg.version ? ` (v${pkg.version})` : ''}`);
    if (pkg.description) out.push(`- **Description:** ${pkg.description}`);
    out.push(`- **Module type:** ${pkg.type === 'module' ? 'ES modules' : 'CommonJS'}`);
  } else {
    out.push(`- **Name:** ${path.basename(cwd)}`);
  }
  const langList = Object.entries(langs).sort((a, b) => b[1] - a[1]);
  if (langList.length) out.push(`- **Languages:** ${langList.slice(0, 6).map(([l, n]) => `${l} (${n})`).join(', ')}`);
  out.push('');

  const commands = [];
  if (pkg?.scripts) for (const [k, v] of Object.entries(pkg.scripts)) commands.push(`- \`npm run ${k}\` — \`${v}\``);
  if (fs.existsSync(path.join(cwd, 'Makefile'))) commands.push('- `make` — see Makefile targets');
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) commands.push('- `cargo build` / `cargo test`');
  if (fs.existsSync(path.join(cwd, 'go.mod'))) commands.push('- `go build ./...` / `go test ./...`');
  if (fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'requirements.txt'))) commands.push('- `pip install -r requirements.txt` / `pytest`');
  if (commands.length) out.push('## Commands', '', ...commands, '');

  if (pkg && (pkg.dependencies || pkg.devDependencies)) {
    out.push('## Dependencies', '');
    if (pkg.dependencies) out.push(`- Runtime: ${Object.keys(pkg.dependencies).map((d) => `\`${d}\``).join(', ')}`);
    if (pkg.devDependencies) out.push(`- Dev: ${Object.keys(pkg.devDependencies).map((d) => `\`${d}\``).join(', ')}`);
    out.push('');
  }

  out.push('## Structure', '');
  for (const e of top.slice(0, 30)) {
    if (e.isDirectory()) {
      const n = files.filter((f) => f.startsWith(e.name + '/')).length;
      out.push(`- \`${e.name}/\` — ${n} file${n === 1 ? '' : 's'}`);
    } else out.push(`- \`${e.name}\``);
  }
  out.push('', '## Notes', '', '<!-- Add conventions here, or type `# <note>` in Zero Code to append. -->', '');

  return { content: out.join('\n'), exists: fs.existsSync(path.join(cwd, MEMORY_FILE)) };
}
