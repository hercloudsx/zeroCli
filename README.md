
<div align="center">

# Zero Code

An agentic coding assistant for the terminal, with a pixel-art mascot named Zero-chan 🌸

[![npm version](https://img.shields.io/badge/version-0.1.0-E8825E?style=flat-square)](package.json)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](#license)
![platforms](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-lightgrey?style=flat-square)

[Installation](#installation) · [Usage](#usage) · [Providers](#providers) · [Commands](#commands) · [Configuration](#configuration) · [Building](#building-a-standalone-executable)

</div>

---

Zero Code is a terminal app that works on your project together with a language model. It can read and search files, edit code, run shell commands and keep a todo list, and it asks for permission before it changes anything. It works with Anthropic, OpenAI and any OpenAI-compatible API, including local models through Ollama or LM Studio.

There is also a built-in mock model, so you can try every feature without an API key. The interface is available in English and Russian.

## Installation

You need Node.js 20 or newer.

```bash
git clone https://github.com/herclouds/zero-code.git
cd zero-code
npm install
npm link    # optional: adds a global `zero` command
```

If you'd rather not install Node, see [Building a standalone executable](#building-a-standalone-executable).

## Usage

```bash
zero                              # interactive session
zero "explore"                    # start with a prompt
zero -p "read package.json"       # answer once and exit; reads stdin too
zero --profile Claude             # use a specific provider profile for this run
zero --full-auto                  # start in full auto mode
zero --permission-mode acceptEdits
zero --dangerously-skip-permissions
```

Without `npm link`, run `npm start` from the project folder.

## Providers

Model connections are saved as profiles in `~/.zero/profiles.json`. Run `/profiles` to add one from a preset, or edit the file by hand.

| Preset     | API type    | Default endpoint               |
| ---------- | ----------- | ------------------------------ |
| Claude     | `anthropic` | `https://api.anthropic.com`    |
| OpenAI     | `openai`    | `https://api.openai.com/v1`    |
| OpenRouter | `openai`    | `https://openrouter.ai/api/v1` |
| Ollama     | `openai`    | `http://localhost:11434/v1`    |
| LM Studio  | `openai`    | `http://localhost:1234/v1`     |
| Custom     | `openai`    | any compatible URL             |
| Zero Mock  | `mock`      | built-in, works offline        |

You can switch profiles at any time, including in the middle of a chat:

```
/profiles                  open the profile manager
/profiles use 2            switch by number or name
/profiles remove <name>    delete a profile
/model                     show the current model and the models the API offers
/model <name>              change the model of the active profile
```

If a profile has no API key saved, Zero Code uses the `ANTHROPIC_API_KEY` or `ZERO_API_KEY` environment variable instead. Anthropic profiles also have settings for effort level and max output tokens.

## Tools

| Tool        | Description |
| ----------- | ----------- |
| `Bash`      | Runs shell commands. The working directory carries over between calls. On Windows it uses Git Bash if it can find it, otherwise PowerShell. |
| `Read`      | Reads a file |
| `Write`     | Creates or overwrites a file |
| `Edit`      | Replaces an exact string in a file. The string has to be unique unless `replace_all` is set. |
| `Glob`      | Finds files by pattern |
| `Grep`      | Searches file contents |
| `LS`        | Lists a directory |
| `WebFetch`  | Downloads a web page |
| `TodoWrite` | Updates the task list |

`Edit` and `Write` won't change an existing file until it has been read in the current session.

## Permissions

Read-only tools and safe commands such as `ls` or `git status` run without asking. Anything else shows a prompt with three choices: yes, yes and don't ask again, or no.

Press `shift+tab` to cycle through the permission modes:

- **default**: ask before edits and commands
- **accept edits**: edit files without asking, but still ask before commands
- **plan**: read-only
- **full auto**: never ask, and keep working through the todo list (see below)

Starting with `--dangerously-skip-permissions` adds a bypass mode that turns off every check.

### Full auto

In full auto, Zero Code doesn't show permission prompts. If a turn ends with unfinished todos, it starts the next turn by itself. *Max autonomous turns* in the settings limits how many times it does this (10 by default). Press `esc` to stop it at any time.

A safety guard stays on in full auto unless you turn it off in the settings. It blocks commands such as `rm -rf /`, disk formatting, `dd` to a device, shutdown, `git push --force`, `git reset --hard`, recursive deletes on Windows, and piping a download into a shell. Bypass mode has no guard.

## Chats

Each conversation is saved per project in `~/.zero/chats/` after every turn.

- `/chat` opens a picker. Use arrow keys and enter to open a chat, `n` for a new one, `r` to rename, and `d` twice to delete.
- `/chat list`, `/chat new [name]`, `/chat 2`, `/chat rename <name>`, `/chat delete <n>`
- `/clear` starts a new chat. The old one stays saved.

The footer shows the token count for the current chat. When the provider reports usage, the count comes from the API. Otherwise it is an estimate.

## Commands

```
/help       /clear      /chat       /compact    /cost       /status
/model      /profiles   /init       /memory     /permissions
/settings   /lang       /todos      /tools      /buddy      /mascot
/verbose    /doctor     /exit
```

### Keyboard shortcuts

| Key                | Action |
| ------------------ | ------ |
| `?`                | Show shortcuts |
| `esc`              | Interrupt the current turn. Press it twice to clear the input. |
| `ctrl+c`           | Clear the input. Press it twice to exit. |
| `ctrl+o`           | Show the full tool output |
| `shift+tab`        | Cycle permission modes |
| `up` / `down`      | Browse input history |
| `\` then `enter`   | Insert a newline |

Prefix a line with `!` to run it as a shell command, or with `#` to save it as a note in `ZERO.md`. Type `@` to autocomplete file paths. If you send messages while a turn is still running, they wait in a queue and run in order.

## Configuration

Run `/settings` to open the settings panel. Changes take effect right away and are saved to `~/.zero/settings.json`. You can also change settings from the command line, for example `/settings hairColor sakura`, `/settings list` or `/settings reset`.

| Section       | Settings |
| ------------- | -------- |
| Appearance    | language, theme, verbose output, spinner tips, display name |
| Zero-chan     | visibility, speech bubbles, hair color, eye color |
| Permissions   | default permission mode |
| Full auto     | max autonomous turns, destructive command guard, auto-continue |
| Tools         | shell (auto / bash / powershell), bash timeout |
| Model         | mock model speed |
| Notifications | terminal bell when a turn finishes |

Hair colors are coral, sakura, sky, lavender, mint, silver and midnight. Eye colors are violet, emerald, ruby, gold and ocean. Zero-chan only appears when the terminal is at least 100 columns wide, and `/buddy` hides her.

### Environment variables

| Variable            | Description |
| ------------------- | ----------- |
| `ANTHROPIC_API_KEY` | API key for Anthropic profiles that don't have one saved |
| `ZERO_API_KEY`      | API key for any profile that doesn't have one saved |
| `ZERO_SHELL`        | Path to the shell the `Bash` tool should use |

### Language

Switch the language with `/lang en` or `/lang ru`, or with the first row of `/settings`. Everything you see in the interface is translated. Anything sent to the model (tool output, `/compact` summaries, `ZERO.md`) and the `zero --help` text stay in English.

## Mock model

The mock model understands a small set of phrases, which is enough to try out every tool:

| Input | Result |
| ----- | ------ |
| `explore` | Lists the project and reads its README and package.json, then gives a summary |
| `read package.json` | Read |
| `list src`, `find *.js`, `search TODO in src` | LS, Glob, Grep |
| `run git status` | Bash |
| `create notes.txt with hello` | Write |
| `replace "hello" with "hi" in notes.txt` | Read, then Edit |
| `todo write tests, fix bug` / `done 1` | TodoWrite |
| `continue` | Works on the next todo |
| `fetch https://example.com` | WebFetch |

The Russian versions work too: `обзор`, `прочитай package.json`, `запусти git status`, `задачи a, b, c`, `продолжай`.

## Building a standalone executable

```bash
npm run build
```

This creates `dist/zero.exe` (`dist/zero` on macOS and Linux). The file is about 90 MB and runs on machines without Node.js. It accepts the same flags as `npm start`.

The build works like this:

1. esbuild bundles the app into a single file, `dist/zero.mjs`.
2. Node's Single Executable Applications feature packs that bundle and a small launcher into a copy of the `node` binary.
3. The first time the executable runs, it unpacks the bundle to `~/.zero/runtime/` and starts it.

The binary isn't signed, so Windows SmartScreen may show a warning the first time you run it.

## Adding a provider

Add a module to `src/providers/` and register it in `src/providers/index.js`. A provider is an async generator that yields events:

```js
async *stream({ system, messages, tools, signal }) {
  // messages use the Anthropic Messages format (text, tool_use and tool_result blocks)
  // tools are { name, description, input_schema }
  yield { type: 'text_delta', text: '...' };
  yield { type: 'tool_use', id, name, input };
  yield { type: 'usage', inputTokens, outputTokens }; // optional
}
```

The engine (`src/agent/engine.js`) handles permissions, tool execution, interrupts and the agent loop.

## Project structure

```
bin/zero.js             entry point: argument parsing, print mode, rendering
src/App.js              main UI
src/mascot.js           Zero-chan sprite and expressions
src/i18n.js             English and Russian strings
src/agent/              agent loop and permission rules
src/providers/          anthropic, openai-compatible and mock providers
src/tools/              tool implementations
src/commands/           slash commands
src/components/         Ink components
src/utils/              settings, profiles, chats, file index
scripts/build-exe.mjs   standalone build
```

## License

MIT
