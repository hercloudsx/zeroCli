import fs from 'node:fs';
import path from 'node:path';
import { AbortError, newId } from '../agent/engine.js';
import { settings } from '../utils/settings.js';
import { t, lang, ruPlural } from '../i18n.js';

/**
 * An offline "model" so the whole agent loop (streaming, tool calls, permissions,
 * tool results) works without any API. It understands a handful of simple
 * commands in English and Russian, turns them into a plan of tool calls, then
 * summarises the results — in Russian when the setting is RU or the user wrote
 * in Cyrillic, otherwise in English.
 *
 * It is stateless like a real model: each call looks only at the transcript.
 */

const SPEED = { slow: 2.2, normal: 1, fast: 0.3, instant: 0 };

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const timer = setTimeout(resolve, ms * (SPEED[settings.mockSpeed] ?? 1));
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(new AbortError())), { once: true });
  });

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const Q_OPEN = `["'\`«“]`;
const Q_CLOSE = `["'\`»”]`;
const cleanArg = (s) =>
  s
    ?.trim()
    .replace(/^@/, '')
    .replace(/^["'`«“]|["'`»”]$/g, '')
    .replace(/[?!,;:]+$/, '')
    .replace(/(?<=\w)\.$/, '');
const unescape = (s) => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SHELL_START = /^(git|npm|npx|node|python3?|py|pip3?|yarn|pnpm|bun|deno|cargo|go|make|docker|echo|pwd|whoami|mkdir|touch|rm|mv|cp|curl|tsc|jest|pytest|ls\s+-)\b/i;

// ---------------------------------------------------------------------------
// Phrasebook
// ---------------------------------------------------------------------------

const en = (n, one, other) => (n === 1 ? one : other);

const LANG_NAMES = {
  en: {
    '.js': 'a JavaScript file', '.mjs': 'a JavaScript file', '.cjs': 'a JavaScript file', '.jsx': 'a JavaScript (React) file',
    '.ts': 'a TypeScript file', '.tsx': 'a TypeScript (React) file', '.py': 'a Python file', '.rs': 'a Rust file', '.go': 'a Go file',
    '.java': 'a Java file', '.rb': 'a Ruby file', '.c': 'a C file', '.cpp': 'a C++ file', '.h': 'a C header file', '.cs': 'a C# file',
    '.php': 'a PHP file', '.swift': 'a Swift file', '.kt': 'a Kotlin file', '.md': 'a Markdown file', '.json': 'a JSON file',
    '.yml': 'a YAML file', '.yaml': 'a YAML file', '.toml': 'a TOML file', '.html': 'an HTML file', '.css': 'a CSS file',
    '.sh': 'a shell script', '.ps1': 'a PowerShell script', '.txt': 'a plain text file', '.sql': 'an SQL file',
  },
  ru: {
    '.js': 'файл JavaScript', '.mjs': 'файл JavaScript', '.cjs': 'файл JavaScript', '.jsx': 'файл JavaScript (React)',
    '.ts': 'файл TypeScript', '.tsx': 'файл TypeScript (React)', '.py': 'файл Python', '.rs': 'файл Rust', '.go': 'файл Go',
    '.java': 'файл Java', '.rb': 'файл Ruby', '.c': 'файл C', '.cpp': 'файл C++', '.h': 'заголовочный файл C', '.cs': 'файл C#',
    '.php': 'файл PHP', '.swift': 'файл Swift', '.kt': 'файл Kotlin', '.md': 'файл Markdown', '.json': 'файл JSON',
    '.yml': 'файл YAML', '.yaml': 'файл YAML', '.toml': 'файл TOML', '.html': 'файл HTML', '.css': 'файл CSS',
    '.sh': 'скрипт оболочки', '.ps1': 'скрипт PowerShell', '.txt': 'текстовый файл', '.sql': 'файл SQL',
  },
};

const EXAMPLES = {
  en: [
    ['explore', 'take a tour of this project'],
    ['read package.json', 'read a file'],
    ['list src', 'list a directory'],
    ['find *.js', 'find files by glob'],
    ['search TODO in src', 'grep file contents'],
    ['run git status', 'run a shell command'],
    ['create notes.txt with hello world', 'write a file'],
    ['replace "hello" with "hi" in notes.txt', 'edit a file'],
    ['todo write tests, fix bug, ship it', 'make a todo list'],
    ['done 1', 'complete a todo'],
    ['fetch https://example.com', 'fetch a web page'],
  ],
  ru: [
    ['обзор', 'осмотреть проект'],
    ['прочитай package.json', 'прочитать файл'],
    ['покажи папку src', 'показать содержимое папки'],
    ['найди *.js', 'найти файлы по шаблону'],
    ['ищи TODO в src', 'поиск по содержимому файлов'],
    ['запусти git status', 'выполнить команду'],
    ['создай notes.txt с текстом привет мир', 'создать файл'],
    ['замени "привет" на "здравствуй" в notes.txt', 'изменить файл'],
    ['задачи написать тесты, исправить баг, выпустить', 'составить список задач'],
    ['готово 1', 'отметить задачу'],
    ['открой https://example.com', 'загрузить страницу'],
  ],
};

const examplesMd = (L) => EXAMPLES[L].map(([c, what]) => `- \`${c}\` — ${what}`).join('\n');

const P = {
  en: {
    explore: "I'll take a look around the project.",
    readFirst: (f) => `I'll read \`${f}\` first, then make the change.`,
    existsReadFirst: (f) => `\`${f}\` already exists — let me read it before overwriting.`,
    create: (f) => `I'll create \`${f}\`.`,
    todoSetup: "I'll set up a todo list to track this.",
    marking: (c) => `Marking **${c}** as done ✓`,
    workingOn: (c) => `Working on **${c}**…`,
    fetching: (u) => `I'll fetch ${u}.`,
    running: (c) => `Running \`${c}\`.`,
    searching: (p, where) => `Searching for \`${p}\`${where ? ` in \`${where}\`` : ''}.`,
    init: "I'll analyze the codebase and create a `ZERO.md` file with notes for future sessions.",
    failed: (msg) => `Hmm, that didn't work:\n\n\`\`\`\n${msg}\n\`\`\`\n\nWant me to try something else?`,
    pkg: (pkg) => `This is the manifest for **${pkg.name ?? 'an unnamed package'}**${pkg.version ? ` v${pkg.version}` : ''}${pkg.description ? ` — ${pkg.description}` : ''}.`,
    deps: (n, list) => `- **Dependencies (${n}):** ${list}`,
    noDeps: '- No runtime dependencies',
    devDeps: (n, list) => `- **Dev dependencies (${n}):** ${list}`,
    scripts: (list) => `- **Scripts:** ${list}`,
    cli: (list) => `- **CLI entry:** ${list}`,
    emptyFile: (f) => `\`${f}\` exists but it's empty.`,
    fileIntro: (f, kind, n) => `\`${f}\` is ${kind ?? 'a file'} with **${n} ${en(n, 'line', 'lines')}**.`,
    sections: 'Sections:',
    definitions: 'Main definitions:',
    imports: (n) => `${n} ${en(n, 'import', 'imports')}`,
    todoMarkers: (n) => `${n} TODO/FIXME ${en(n, 'marker', 'markers')}`,
    has: (parts) => `It has ${parts.join(' and ')}.`,
    project: {
      ts: 'a TypeScript / Node.js project', node: 'a Node.js project', py: 'a Python project', rs: 'a Rust project',
      go: 'a Go project', java: 'a Java project', web: 'a static web project', generic: 'a project',
    },
    exploreIntro: (kind, d, f) => `This looks like ${kind} with ${d} top-level ${en(d, 'directory', 'directories')} and ${f} ${en(f, 'file', 'files')}.`,
    dirsLabel: '**Directories:**',
    filesLabel: '**Files:**',
    exploreOutro: 'Ask me to `read`, `search` or `find` anything for a closer look!',
    dirEmpty: (p) => `\`${p}\` is empty.`,
    dirContains: (p, d, f) => `\`${p}\` contains ${d} ${en(d, 'directory', 'directories')} and ${f} ${en(f, 'file', 'files')}:`,
    andMore: (n) => `- … and ${n} more`,
    noGlob: (p) => `No files match \`${p}\`.`,
    globFound: (n, p) => `Found ${n} ${en(n, 'file', 'files')} matching \`${p}\` (most recently modified first):`,
    noGrep: (p) => `No matches for \`${p}\`.`,
    grepFound: (n, f) => `Found ${n} ${en(n, 'match', 'matches')} across ${f} ${en(f, 'file', 'files')}:`,
    noOutput: 'The command finished with no output.',
    bashOutput: (lines) => `Done! Here's the output${lines > 25 ? ` (last 25 of ${lines} lines)` : ''}:`,
    created: (f) => `Created \`${f}\` ✧`,
    updated: (f) => `Updated \`${f}\` with the new content.`,
    replaced: (all, a, b, f) => `Done! Replaced ${all ? 'every occurrence of ' : ''}\`${a}\` with \`${b}\` in \`${f}\`.`,
    pageStart: "Here's the beginning of the page:",
    pageNote: "_(Without a model connected I can't summarise it properly, but the full text was fetched.)_",
    allDone: 'All todos complete! お疲れ様 ✧',
    finished: (c, done, total, next) => `Finished **${c}** ✓ (${done}/${total}). Next up: **${next}**.`,
    progress: (done, total) => `${done}/${total} done. Say \`done <n>\` to check off more.`,
    todoCreated: (n) => `Got it — ${n} ${en(n, 'item', 'items')} on the list. Say \`done 1\` when the first one is finished.`,
    doneGeneric: 'Done!',
    greet: () => pick(['Hi there! ', 'Hello hello~ ', 'Yo! ']) + "I'm **Zero-chan** ✧ What should we work on?\n\nI'm running in offline mode, so try one of these:\n\n" + examplesMd('en'),
    nothingLeft: "Nothing left on the todo list — I'm all caught up! ✧ Give me a new task with `todo …`.",
    thanks: () => pick(["You're welcome! ✧", 'Anytime~', 'Happy to help! (｡•̀ᴗ-)✧']),
    whoami: "I'm **Zero-chan**, the mascot and agent of Zero Code! Right now I'm a tiny offline model — I can read, search and edit files and run commands, but I only understand simple instructions until a real model API is connected.",
    help: () => "Here's what I understand in offline mode:\n\n" + examplesMd('en') + '\n\nType `/` to see slash commands, `!` for bash mode, and `?` for shortcuts.',
    unknown: () =>
      "Sorry, I didn't catch that! (・・；) No model API is connected yet, so I only understand simple instructions.\n\nTry one of these:\n\n" +
      examplesMd('en') +
      '\n\nTo plug in a real model, implement a provider in `src/providers/` (see the README).',
  },
  ru: {
    explore: 'Сейчас осмотрю проект.',
    readFirst: (f) => `Сначала прочитаю \`${f}\`, потом внесу изменение.`,
    existsReadFirst: (f) => `\`${f}\` уже существует — сначала прочитаю его, потом перезапишу.`,
    create: (f) => `Создаю \`${f}\`.`,
    todoSetup: 'Составлю список задач, чтобы ничего не потерять.',
    marking: (c) => `Отмечаю **${c}** как выполненную ✓`,
    workingOn: (c) => `Работаю над **${c}**…`,
    fetching: (u) => `Загружаю ${u}.`,
    running: (c) => `Выполняю \`${c}\`.`,
    searching: (p, where) => `Ищу \`${p}\`${where ? ` в \`${where}\`` : ''}.`,
    init: 'Проанализирую кодовую базу и создам `ZERO.md` с заметками для будущих сессий.',
    failed: (msg) => `Хм, не получилось:\n\n\`\`\`\n${msg}\n\`\`\`\n\nПопробовать что-нибудь другое?`,
    pkg: (pkg) => `Это манифест пакета **${pkg.name ?? 'без имени'}**${pkg.version ? ` v${pkg.version}` : ''}${pkg.description ? ` — ${pkg.description}` : ''}.`,
    deps: (n, list) => `- **Зависимости (${n}):** ${list}`,
    noDeps: '- Зависимостей нет',
    devDeps: (n, list) => `- **Dev-зависимости (${n}):** ${list}`,
    scripts: (list) => `- **Скрипты:** ${list}`,
    cli: (list) => `- **Точка входа CLI:** ${list}`,
    emptyFile: (f) => `\`${f}\` существует, но пустой.`,
    fileIntro: (f, kind, n) => `\`${f}\` — ${kind ?? 'файл'}, **${n} ${ruPlural(n, 'строка', 'строки', 'строк')}**.`,
    sections: 'Разделы:',
    definitions: 'Основные определения:',
    imports: (n) => `${n} ${ruPlural(n, 'импорт', 'импорта', 'импортов')}`,
    todoMarkers: (n) => `${n} ${ruPlural(n, 'пометка', 'пометки', 'пометок')} TODO/FIXME`,
    has: (parts) => `В нём ${parts.join(' и ')}.`,
    project: {
      ts: 'проект на TypeScript / Node.js', node: 'проект на Node.js', py: 'проект на Python', rs: 'проект на Rust',
      go: 'проект на Go', java: 'проект на Java', web: 'статический веб-проект', generic: 'проект',
    },
    exploreIntro: (kind, d, f) =>
      `Похоже, это ${kind}: ${d} ${ruPlural(d, 'папка', 'папки', 'папок')} и ${f} ${ruPlural(f, 'файл', 'файла', 'файлов')} в корне.`,
    dirsLabel: '**Папки:**',
    filesLabel: '**Файлы:**',
    exploreOutro: 'Попроси меня `прочитай`, `ищи` или `найди` что-нибудь, чтобы рассмотреть поближе!',
    dirEmpty: (p) => `\`${p}\` пустая.`,
    dirContains: (p, d, f) =>
      `В \`${p}\` ${d} ${ruPlural(d, 'папка', 'папки', 'папок')} и ${f} ${ruPlural(f, 'файл', 'файла', 'файлов')}:`,
    andMore: (n) => `- … и ещё ${n}`,
    noGlob: (p) => `Нет файлов по шаблону \`${p}\`.`,
    globFound: (n, p) => `${ruPlural(n, 'Найден', 'Найдено', 'Найдено')} ${n} ${ruPlural(n, 'файл', 'файла', 'файлов')} по шаблону \`${p}\` (сначала недавно изменённые):`,
    noGrep: (p) => `Совпадений для \`${p}\` нет.`,
    grepFound: (n, f) =>
      `${ruPlural(n, 'Найдено', 'Найдено', 'Найдено')} ${n} ${ruPlural(n, 'совпадение', 'совпадения', 'совпадений')} в ${f} ${ruPlural(f, 'файле', 'файлах', 'файлах')}:`,
    noOutput: 'Команда выполнилась без вывода.',
    bashOutput: (lines) => `Готово! Вот вывод${lines > 25 ? ` (последние 25 из ${lines} строк)` : ''}:`,
    created: (f) => `Создала \`${f}\` ✧`,
    updated: (f) => `Обновила \`${f}\` новым содержимым.`,
    replaced: (all, a, b, f) => `Готово! Заменила ${all ? 'все вхождения ' : ''}\`${a}\` на \`${b}\` в \`${f}\`.`,
    pageStart: 'Вот начало страницы:',
    pageNote: '_(Без подключённой модели я не могу нормально пересказать страницу, но весь текст загружен.)_',
    allDone: 'Все задачи выполнены! お疲れ様 ✧',
    finished: (c, done, total, next) => `**${c}** — готово ✓ (${done}/${total}). Дальше: **${next}**.`,
    progress: (done, total) => `Выполнено ${done}/${total}. Скажи \`готово <n>\`, чтобы отметить ещё.`,
    todoCreated: (n) => `Принято — в списке ${n} ${ruPlural(n, 'задача', 'задачи', 'задач')}. Скажи \`готово 1\`, когда первая будет сделана.`,
    doneGeneric: 'Готово!',
    greet: () => pick(['Привет! ', 'Приветик~ ', 'Йо! ']) + 'Я **Zero-chan** ✧ Над чем поработаем?\n\nЯ сейчас в офлайн-режиме, попробуй что-нибудь из этого:\n\n' + examplesMd('ru'),
    nothingLeft: 'В списке задач ничего не осталось — я всё сделала! ✧ Дай новое задание через `задачи …`.',
    thanks: () => pick(['Пожалуйста! ✧', 'Обращайся~', 'Рада помочь! (｡•̀ᴗ-)✧']),
    whoami: 'Я **Zero-chan**, маскот и агент Zero Code! Сейчас я маленькая офлайн-модель: умею читать, искать и править файлы и запускать команды, но понимаю только простые инструкции, пока не подключён настоящий API модели.',
    help: () => 'Вот что я понимаю в офлайн-режиме:\n\n' + examplesMd('ru') + '\n\nВведи `/`, чтобы увидеть команды, `!` для режима bash и `?` для горячих клавиш.',
    unknown: () =>
      'Прости, не поняла! (・・；) API модели пока не подключён, поэтому я понимаю только простые инструкции.\n\nПопробуй так:\n\n' +
      examplesMd('ru') +
      '\n\nЧтобы подключить настоящую модель, добавь провайдер в `src/providers/` (см. README).',
  },
};

// ---------------------------------------------------------------------------
// Intent parsing -> plan of steps. Each step: { say?, tool, input }
// ---------------------------------------------------------------------------

function parseIntent(raw, cwd, todos, L) {
  const p = P[L];
  const text = raw.trim();
  const low = text.toLowerCase();
  const exists = (f) => fs.existsSync(path.resolve(cwd, f));
  const isDir = (f) => exists(f) && fs.statSync(path.resolve(cwd, f)).isDirectory();
  const any = (...res) => {
    for (const re of res) {
      const m = re.exec(text);
      if (m) return m;
    }
    return null;
  };
  let m;

  if (/^(hi|hello|hey|yo|hiya|ohayo|konnichiwa|sup)\b|^(привет|здравствуй|хай|приветик|йо|доброе утро|добрый день|добрый вечер)/.test(low)) return { kind: 'greet', steps: [] };
  if (/^(help|\?|what can you do|commands)\b|^(помощь|помоги|справка|что ты умеешь|команды)/.test(low)) return { kind: 'help', steps: [] };
  if (/(who are you|your name|what are you)|(кто ты|ты кто|как тебя зовут)/.test(low)) return { kind: 'whoami', steps: [] };
  if (/^(thanks|thank you|thx|ty|arigato)|^(спасибо|спс|благодарю|аригато)/.test(low)) return { kind: 'thanks', steps: [] };

  // "continue" works through the todo list one item per turn (used by full auto mode).
  if (/^(continue|keep going|go on|carry on|next|proceed)\b|^(продолжай|продолжи|дальше|далее|давай дальше|следующ)/.test(low)) {
    const idx = todos.findIndex((td) => td.status === 'in_progress');
    const n = idx !== -1 ? idx : todos.findIndex((td) => td.status === 'pending');
    if (n === -1) return { kind: 'nothing-left', steps: [] };
    const next = todos.map((td, i) => ({ ...td, status: i === n ? 'completed' : td.status }));
    const following = next.findIndex((td) => td.status === 'pending');
    if (following !== -1) next[following].status = 'in_progress';
    return {
      kind: 'continue',
      steps: [{ say: p.workingOn(todos[n].content), tool: 'TodoWrite', input: { todos: next } }],
      finished: todos[n].content,
      upNext: following !== -1 ? next[following].content : null,
    };
  }

  if (
    /^(explore|tour|overview)\b|what('s| is) (in )?this (project|repo|codebase)|(explain|describe|summari[sz]e) (this|the) (project|repo|codebase)/.test(low) ||
    /^(обзор|осмотрись|осмотри проект|исследуй|экскурсия)|(что в этом|расскажи о|опиши|объясни) (этом |этот )?(проект|репозитори)/.test(low)
  ) {
    const steps = [{ say: p.explore, tool: 'LS', input: { path: '.' } }];
    const doc = ['README.md', 'readme.md', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'].find(exists);
    if (doc) steps.push({ tool: 'Read', input: { file_path: doc, limit: 200 } });
    return { kind: 'explore', steps };
  }

  // replace "a" with "b" in file  /  замени "a" на "b" в файле
  if (
    (m = any(
      new RegExp(`replace\\s+${Q_OPEN}([\\s\\S]+?)${Q_CLOSE}\\s+with\\s+${Q_OPEN}([\\s\\S]*?)${Q_CLOSE}\\s+in\\s+(\\S+)`, 'i'),
      new RegExp(`замени(?:ть)?\\s+(?:все\\s+)?${Q_OPEN}([\\s\\S]+?)${Q_CLOSE}\\s+на\\s+${Q_OPEN}([\\s\\S]*?)${Q_CLOSE}\\s+в\\s+(?:файле\\s+)?(\\S+)`, 'i'),
    ))
  ) {
    const file = cleanArg(m[3]);
    return {
      kind: 'edit',
      steps: [
        { say: p.readFirst(file), tool: 'Read', input: { file_path: file } },
        { tool: 'Edit', input: { file_path: file, old_string: unescape(m[1]), new_string: unescape(m[2]), replace_all: /\ball\b|(^|\s)все(\s|$)/i.test(text) } },
      ],
    };
  }

  // create file X with Y  /  создай файл X с текстом Y
  m = any(
    /^(?:create|write|make|add)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?(?:called\s+|named\s+)?(\S+?)\s*(?:(?:with|containing|that says|saying)\s+([\s\S]+))?$/i,
    /^(?:создай|создать|напиши|запиши|сделай)\s+(?:новый\s+)?(?:файл\s+)?(\S+?)\s*(?:(?:с\s+текстом|с\s+содержимым|со\s+словами|с)\s+([\s\S]+))?$/i,
  );
  if (m && /\.\w+$|\//.test(cleanArg(m[1]))) {
    const file = cleanArg(m[1]);
    const content = m[2] !== undefined ? unescape(cleanArg(m[2])) + '\n' : '';
    const steps = [];
    if (exists(file)) steps.push({ say: p.existsReadFirst(file), tool: 'Read', input: { file_path: file } });
    steps.push({ say: steps.length ? undefined : p.create(file), tool: 'Write', input: { file_path: file, content } });
    return { kind: 'write', steps };
  }

  // todos
  if ((m = any(/^(?:todo|todos|plan|make a (?:todo|plan)(?: list)?)\s*[:\-]?\s+([\s\S]+)$/i, /^(?:задачи|задача|список задач|туду|план)\s*[:\-]?\s+([\s\S]+)$/i))) {
    const items = m[1]
      .split(/\s*(?:,|;|\n|\band then\b|\bthen\b|\sи затем\s|\sзатем\s|\sпотом\s)\s*/i)
      .map((s) => s.trim())
      .filter(Boolean);
    const todo = items.map((content, i) => ({
      content: content[0].toUpperCase() + content.slice(1),
      status: i === 0 ? 'in_progress' : 'pending',
      activeForm: content,
    }));
    return { kind: 'todo', steps: [{ say: p.todoSetup, tool: 'TodoWrite', input: { todos: todo } }] };
  }
  if ((m = any(/^(?:done|complete|finish|check(?: off)?)\s+(?:todo\s+)?#?(\d+)/i, /^(?:готово|сделано|выполнено|отметь)\s+(?:задачу\s+)?#?(\d+)/i)) && todos.length) {
    const n = Number(m[1]) - 1;
    if (todos[n]) {
      const next = todos.map((td, i) => ({ ...td, status: i === n ? 'completed' : td.status }));
      const firstPending = next.findIndex((td) => td.status === 'pending');
      if (!next.some((td) => td.status === 'in_progress') && firstPending !== -1) next[firstPending].status = 'in_progress';
      return { kind: 'todo-done', steps: [{ say: p.marking(todos[n].content), tool: 'TodoWrite', input: { todos: next } }] };
    }
  }

  // URLs
  if ((m = /(https?:\/\/[^\s"'<>»]+)/i.exec(text))) {
    return { kind: 'fetch', steps: [{ say: p.fetching(m[1]), tool: 'WebFetch', input: { url: m[1], prompt: text } }] };
  }

  // explicit shell commands
  if ((m = any(/^(?:run|exec|execute|\$|!)\s+([\s\S]+)$/i, /^(?:запусти|выполни|исполни)\s+(?:команду\s+)?([\s\S]+)$/i, /^`([^`]+)`$/))) {
    const command = m[1].trim().replace(/^`|`$/g, '');
    return { kind: 'bash', steps: [{ say: p.running(command), tool: 'Bash', input: { command, description: t('tool.bashDescription') } }] };
  }
  if (SHELL_START.test(text)) {
    return { kind: 'bash', steps: [{ tool: 'Bash', input: { command: text, description: t('tool.bashDescription') } }] };
  }

  // search / grep
  if (
    (m = any(
      new RegExp(`^(?:search|grep|look)\\s+(?:for\\s+)?${Q_OPEN}?(.+?)${Q_CLOSE}?(?:\\s+in\\s+(\\S+))?$`, 'i'),
      new RegExp(`^where\\s+is\\s+${Q_OPEN}?(.+?)${Q_CLOSE}?\\s+(?:used|defined|referenced)(?:\\s+in\\s+(\\S+))?`, 'i'),
      new RegExp(`^(?:ищи|поищи текст|найди текст|поиск|искать|грепни)\\s+(?:по\\s+)?${Q_OPEN}?(.+?)${Q_CLOSE}?(?:\\s+в\\s+(\\S+))?$`, 'i'),
      new RegExp(`^где\\s+(?:используется|определ[её]н[аоы]?|встречается)\\s+${Q_OPEN}?(.+?)${Q_CLOSE}?(?:\\s+в\\s+(\\S+))?$`, 'i'),
    ))
  ) {
    const where = m[2] ? cleanArg(m[2]) : undefined;
    return {
      kind: 'grep',
      steps: [{ say: p.searching(m[1], where), tool: 'Grep', input: { pattern: escapeRegex(m[1]), path: where, output_mode: 'content', '-i': true, head_limit: 50 } }],
    };
  }

  // find / glob
  if (
    (m = any(
      /^(?:find|glob|locate)\s+(?:all\s+)?(?:the\s+)?(?:files\s+)?(?:matching\s+|named\s+|called\s+)?(\S+)(?:\s+files)?(?:\s+in\s+(\S+))?$/i,
      /^(?:найди|найти|поищи)\s+(?:все\s+)?(?:файлы\s+)?(?:с\s+именем\s+)?(\S+)(?:\s+файлы)?(?:\s+в\s+(\S+))?$/i,
    ))
  ) {
    let pattern = cleanArg(m[1]);
    if (!/[*?{[\/]/.test(pattern)) pattern = pattern.startsWith('.') ? `**/*${pattern}` : `**/*${pattern}*`;
    else if (!pattern.includes('/')) pattern = `**/${pattern}`;
    return { kind: 'glob', steps: [{ tool: 'Glob', input: { pattern, path: m[2] ? cleanArg(m[2]) : undefined } }] };
  }

  // list dir
  if (
    (m = any(
      /^(?:ls|list|dir|tree)(?:\s+(?:all\s+)?(?:the\s+)?(?:files|contents|directory|folder))?(?:\s+(?:in|of|inside))?\s*(\S+)?$/i,
      /^(?:покажи\s+(?:папку|файлы|содержимое)|содержимое(?:\s+папки)?|список(?:\s+файлов)?|папка|дерево)(?:\s+(?:в|папки))?\s*(\S+)?$/i,
    ))
  ) {
    return { kind: 'ls', steps: [{ tool: 'LS', input: { path: m[1] ? cleanArg(m[1]) : '.' } }] };
  }

  // read / explain a file
  if (
    (m = any(
      /^(?:read|open|show(?:\s+me)?|cat|view|print|explain|describe|summari[sz]e|what(?:'s| is)\s+in)\s+(?:the\s+)?(?:file\s+)?(\S+)$/i,
      /^(?:прочитай|прочти|открой|покажи|выведи|объясни|опиши|что\s+в)\s+(?:файл\s+|файле\s+)?(\S+)$/i,
    ))
  ) {
    const file = cleanArg(m[1]);
    if (isDir(file)) return { kind: 'ls', steps: [{ tool: 'LS', input: { path: file } }] };
    return { kind: /^(explain|describe|summari|объясни|опиши)/i.test(low) ? 'explain' : 'read', steps: [{ tool: 'Read', input: { file_path: file } }] };
  }

  // a bare existing path
  if (/^\S+$/.test(text) && exists(cleanArg(text))) {
    const f = cleanArg(text);
    return isDir(f) ? { kind: 'ls', steps: [{ tool: 'LS', input: { path: f } }] } : { kind: 'read', steps: [{ tool: 'Read', input: { file_path: f } }] };
  }

  return { kind: 'unknown', steps: [] };
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

const stripLineNumbers = (content) =>
  content
    .split('\n')
    .map((l) => l.replace(/^\s*\d+\t/, ''))
    .join('\n');

const codeList = (items) => items.map((d) => `\`${d}\``).join(', ');

function describeFile(file, content, L) {
  const p = P[L];
  const body = stripLineNumbers(content);
  const lines = content.startsWith('<system-reminder>') ? 0 : content.split('\n').length;
  const ext = path.extname(file).toLowerCase();

  if (path.basename(file) === 'package.json') {
    try {
      const pkg = JSON.parse(body);
      const deps = Object.keys(pkg.dependencies ?? {});
      const dev = Object.keys(pkg.devDependencies ?? {});
      const scripts = Object.entries(pkg.scripts ?? {});
      return [
        p.pkg(pkg),
        '',
        deps.length ? p.deps(deps.length, codeList(deps)) : p.noDeps,
        dev.length ? p.devDeps(dev.length, codeList(dev)) : null,
        scripts.length ? p.scripts(scripts.map(([k, v]) => `\`${k}\` → \`${v}\``).join(', ')) : null,
        pkg.bin ? p.cli(typeof pkg.bin === 'string' ? `\`${pkg.bin}\`` : Object.entries(pkg.bin).map(([k, v]) => `\`${k}\` → \`${v}\``).join(', ')) : null,
      ]
        .filter((l) => l !== null)
        .join('\n');
    } catch {}
  }

  if (!lines) return p.emptyFile(file);

  const symbols = new Set();
  const re = /(?:function\*?\s+(\w+)|class\s+(\w+)|def\s+(\w+)|fn\s+(\w+)|func\s+(?:\([^)]*\)\s*)?(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|^##?\s+(.+)$)/gm;
  let m;
  while ((m = re.exec(body)) && symbols.size < 10) {
    const name = m.slice(1).find(Boolean);
    if (name) symbols.add(name.trim());
  }
  const imports = (body.match(/^\s*(?:import\s.+from\s+['"]([^'"]+)['"]|(?:const|let)\s+\w+\s*=\s*require\(['"]([^'"]+)['"]\)|from\s+(\S+)\s+import|import\s+(\S+))/gm) ?? []).length;
  const todoCount = (body.match(/\b(TODO|FIXME|HACK)\b/g) ?? []).length;

  const parts = [p.fileIntro(file, LANG_NAMES[L][ext], lines)];
  if (symbols.size) parts.push('', ext === '.md' ? p.sections : p.definitions, ...[...symbols].map((s) => `- \`${s}\``));
  const extra = [];
  if (imports) extra.push(p.imports(imports));
  if (todoCount) extra.push(p.todoMarkers(todoCount));
  if (extra.length) parts.push('', p.has(extra));
  return parts.join('\n');
}

function detectProject(entries) {
  const has = (n) => entries.some((e) => e.toLowerCase() === n.toLowerCase());
  if (has('package.json')) return has('tsconfig.json') ? 'ts' : 'node';
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) return 'py';
  if (has('Cargo.toml')) return 'rs';
  if (has('go.mod')) return 'go';
  if (has('pom.xml') || has('build.gradle')) return 'java';
  if (has('index.html')) return 'web';
  return 'generic';
}

function summarise(intent, results, cwd) {
  const L = intent.lang;
  const p = P[L];
  const last = results[results.length - 1];
  if (last.isError) {
    if (last.content.startsWith("The user doesn't want")) return null;
    return p.failed(last.content.slice(0, 1500));
  }
  // An explore turn is summarised from its directory listing, whatever ran last.
  const primary = intent.kind === 'explore' ? results.find((r) => r.name === 'LS' && !r.isError) ?? last : last;
  const c = primary.content;
  const input = primary.input;

  switch (primary.name) {
    case 'Read':
      return describeFile(input.file_path, c, L);
    case 'LS': {
      const top = c.split('\n').filter((l) => /^  - /.test(l)).map((l) => l.slice(4));
      const dirs = top.filter((e) => e.endsWith('/'));
      const files = top.filter((e) => !e.endsWith('/'));
      if (intent.kind === 'explore') {
        const readResult = results.find((r) => r.name === 'Read' && !r.isError);
        const out = [p.exploreIntro(p.project[detectProject(files)], dirs.length, files.length), ''];
        if (dirs.length) out.push(`${p.dirsLabel} ${codeList(dirs)}`);
        if (files.length) out.push(`${p.filesLabel} ${codeList(files.slice(0, 20))}`);
        if (readResult) out.push('', `### ${path.basename(readResult.input.file_path)}`, describeFile(readResult.input.file_path, readResult.content, L));
        out.push('', p.exploreOutro);
        return out.join('\n');
      }
      if (!top.length) return p.dirEmpty(input.path);
      return [
        p.dirContains(input.path, dirs.length, files.length),
        '',
        ...dirs.map((d) => `- **${d}**`),
        ...files.slice(0, 30).map((f) => `- ${f}`),
        files.length > 30 ? p.andMore(files.length - 30) : null,
      ]
        .filter((l) => l !== null)
        .join('\n');
    }
    case 'Glob': {
      if (c === 'No files found') return p.noGlob(input.pattern);
      const files = c.split('\n').filter((l) => !l.startsWith('('));
      return [p.globFound(files.length, input.pattern), '', ...files.slice(0, 25).map((f) => `- ${path.relative(cwd, f) || f}`), files.length > 25 ? p.andMore(files.length - 25) : null]
        .filter((l) => l !== null)
        .join('\n');
    }
    case 'Grep': {
      if (c === 'No matches found') return p.noGrep(input.pattern);
      const lines = c.split('\n');
      const files = new Set(lines.map((l) => l.split(':')[0]));
      return [
        p.grepFound(lines.length, files.size),
        '',
        ...lines.slice(0, 20).map((l) => {
          const [f, n, ...rest] = l.split(':');
          return `- \`${f}:${n}\` ${rest.join(':').trim().slice(0, 100)}`;
        }),
        lines.length > 20 ? p.andMore(lines.length - 20) : null,
      ]
        .filter((l) => l !== null)
        .join('\n');
    }
    case 'Bash': {
      const out = c.trim();
      if (out === '(No content)') return p.noOutput;
      const lines = out.split('\n');
      return `${p.bashOutput(lines.length)}\n\n\`\`\`\n${lines.slice(-25).join('\n')}\n\`\`\``;
    }
    case 'Write':
      return c.startsWith('File created') ? p.created(input.file_path) : p.updated(input.file_path);
    case 'Edit':
      return p.replaced(input.replace_all, input.old_string.split('\n')[0].slice(0, 40), input.new_string.split('\n')[0].slice(0, 40), input.file_path);
    case 'WebFetch': {
      const snippet = c.slice(0, 600).split('\n').filter(Boolean).slice(0, 8).map((l) => `> ${l}`).join('\n');
      return `${p.pageStart}\n\n${snippet}\n\n${p.pageNote}`;
    }
    case 'TodoWrite': {
      const todos = input.todos;
      const done = todos.filter((td) => td.status === 'completed').length;
      if (done === todos.length) return p.allDone;
      if (intent.kind === 'continue') return p.finished(intent.finished, done, todos.length, intent.upNext);
      return intent.kind === 'todo-done' ? p.progress(done, todos.length) : p.todoCreated(todos.length);
    }
    default:
      return p.doneGeneric;
  }
}

function chatReply(intent) {
  const p = P[intent.lang];
  switch (intent.kind) {
    case 'greet':
      return p.greet();
    case 'nothing-left':
      return p.nothingLeft;
    case 'thanks':
      return p.thanks();
    case 'whoami':
      return p.whoami;
    case 'help':
      return p.help();
    default:
      return p.unknown();
  }
}

// ---------------------------------------------------------------------------

/** Find the last real user text message and everything the "model" did since. */
function turnState(messages) {
  let idx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && m.content.some((b) => b.type === 'text' && !b.text.startsWith('[Request interrupted'))) {
      idx = i;
      break;
    }
  }
  const userMsg = messages[idx];
  const userText = idx === -1 ? '' : userMsg.content.find((b) => b.type === 'text').text;
  const toolUses = new Map();
  const results = [];
  for (const m of messages.slice(idx + 1)) {
    for (const b of m.content) {
      if (b.type === 'tool_use') toolUses.set(b.id, b);
      if (b.type === 'tool_result') {
        const tu = toolUses.get(b.tool_use_id);
        results.push({ name: tu?.name, input: tu?.input ?? {}, content: String(b.content), isError: !!b.is_error });
      }
    }
  }
  return { userMsg, userText, results };
}

function parseCommand(text, L) {
  const m = /<zero-command name="(\w+)"[^>]*>([\s\S]*)<\/zero-command>/.exec(text);
  if (m?.[1] === 'init') {
    const data = JSON.parse(m[2]);
    return {
      kind: 'init',
      steps: [
        { say: P[L].init, tool: 'LS', input: { path: '.' } },
        ...(data.exists ? [{ tool: 'Read', input: { file_path: 'ZERO.md' } }] : []),
        { tool: 'Write', input: { file_path: 'ZERO.md', content: data.content } },
      ],
    };
  }
  return { kind: 'unknown', steps: [] };
}

export class MockProvider {
  constructor() {
    this.name = 'mock';
    this.plans = new WeakMap();
  }

  get label() {
    return t('mock.label');
  }

  get description() {
    return t('mock.description');
  }

  async *#streamText(text, signal) {
    const chunks = text.match(/\s*\S+|\s+/g) ?? [];
    for (let i = 0; i < chunks.length; i += 2) {
      await sleep(rand(12, 35), signal);
      yield { type: 'text_delta', text: chunks.slice(i, i + 2).join('') };
    }
  }

  async *stream({ messages, signal, cwd, todos }) {
    const { userMsg, userText, results } = turnState(messages);
    // Plan once per user message, so later steps don't change as files change.
    let intent = userMsg && this.plans.get(userMsg);
    if (!intent) {
      // Reply in Russian if the user wrote Cyrillic, otherwise in the configured language.
      const isCommand = userText.startsWith('<zero-command');
      const L = !isCommand && /[а-яё]/i.test(userText) ? 'ru' : lang();
      // Commands like /init send a structured request the mock can act on directly.
      intent = userText.startsWith('<zero-command') ? parseCommand(userText, L) : parseIntent(userText, cwd, todos, L);
      intent.lang = L;
      if (userMsg) this.plans.set(userMsg, intent);
    }

    await sleep(results.length ? rand(250, 600) : rand(600, 1300), signal);

    const step = intent.steps[results.length];
    const lastFailed = results.length && results[results.length - 1].isError;

    if (step && !lastFailed) {
      if (step.say) yield* this.#streamText(step.say, signal);
      await sleep(rand(80, 200), signal);
      yield { type: 'tool_use', id: newId('toolu'), name: step.tool, input: step.input };
      return;
    }

    const reply = results.length ? summarise(intent, results, cwd) : chatReply(intent);
    if (reply) yield* this.#streamText(reply, signal);
  }
}
