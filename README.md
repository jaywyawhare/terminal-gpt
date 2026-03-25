# Terminal-GPT

ChatGPT in your terminal - no API key, no auth, no setup.

![Terminal-GPT](https://img.shields.io/npm/v/@jaywyawhare/terminal-gpt?label=npm&color=cyan)
![License](https://img.shields.io/badge/license-ISC-blue)

## Quick Start

```bash
npx @jaywyawhare/terminal-gpt
```

That's it. No OpenAI account, no API key, no configuration.

## Features

- **Zero auth** — Uses ChatGPT's anonymous API, no login required
- **Streaming responses** — Tokens appear as they're generated
- **Full TUI** — Proper terminal UI built with Ink (React for CLI)
- **Mouse scroll** — Scroll through messages with your mouse/touchpad
- **Keyboard navigation** — Arrow keys to scroll, Esc to quit
- **Multi-turn conversations** — Context is maintained across messages
- **Scrollbar** — Visual scroll indicator on the right side

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/new`  | Start a new conversation |
| `/quit` | Exit Terminal-GPT |
| `Esc`   | Exit Terminal-GPT |

## Install Globally

```bash
npm install -g @jaywyawhare/terminal-gpt
```

Then run with:

```bash
terminal-gpt
```

