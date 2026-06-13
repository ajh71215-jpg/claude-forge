<div align="center">

# ⚒ Claude Forge

**A daily-driver desktop GUI for the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).**

Stream agentic work in a dark amber blacksmith workshop — single-conversation **Chat** or concurrent multi-agent **Squad**.

Electron · TypeScript · React · electron-vite · local-only · BYO key

</div>

---

## Overview

Claude Forge wraps `@anthropic-ai/claude-agent-sdk` in a native desktop app so you can run agentic conversations with live streaming of thinking, tool calls, and responses — without living in a terminal. It reuses your existing **Claude subscription login**, runs everything **locally**, and never sends your keys or content to any third-party server.

## Features

- **Live streaming** — thinking, tool-use cards, and text render as the agent works.
- **Three auth modes** — Claude **subscription** (reuses your `~/.claude` login), setup-token, or API key. In subscription mode the app strips any `ANTHROPIC_API_KEY` so your plan is used.
- **Model & effort control** — Opus 4.8 (1M), Sonnet 4.6 (+1M), Haiku 4.5, or any arbitrary model ID (`/model claude-opus-4-6`, just like the CLI). Effort `auto → low → medium → high → xhigh → max`.
- **Permission modes** — `PLAN` (read-only), `ASK` (approve each tool), `AUTO-EDIT` (auto-approve edits), `YOLO` (bypass).
- **Sessions** — conversations list with **resume** and full **transcript restore**; `/compact` to summarize older context and free tokens.
- **Composer niceties** — prompt history (`↑`/`↓`), message actions (copy / retry / edit), image attachments, slash-command menu.
- **Squad (multi-agent)** — configure several agents and run them **concurrently** in a live grid. Supports both *compare/race* (same task across models) and *divide-and-conquer* (per-agent tasks). Presets: **model race**, **review panel**, **research fan-out**. Safety-first: agents default to **PLAN / read-only** so parallel runs never collide on files.
- **MCP server status**, **subscription usage %** panel, custom **persona/system prompt**, **token optimization**, **Pretendard** Korean font, frameless custom titlebar + themed scrollbar.

## Tech stack

| Layer | What |
|---|---|
| **main** (Node) | `@anthropic-ai/claude-agent-sdk`, window + IPC, auth, per-runId streaming runner |
| **preload** | context-isolated `window.forge` bridge |
| **renderer** | React + `react-markdown`, all UI in `App.tsx` |
| **bundler** | electron-vite (Vite 6) |

## Getting started

### Prerequisites
- **Node.js** 20+ (developed on 24.x)
- An active **Claude subscription** logged in via Claude Code (`~/.claude`), or an Anthropic API key.

### Install & run (standard environment)
```bash
npm install
npm run dev          # launches the app with HMR
```

### Build a production bundle
```bash
npm run build        # → out/
npm run start        # preview the built app
```

### Typecheck
```bash
npm run typecheck
```

> **Building on a locked-down Windows machine?** If `cmd.exe` is blocked, esbuild gets quarantined by AV, or the electron binary won't extract, see **[CLAUDE.md](./CLAUDE.md)** for the exact workarounds (`--ignore-scripts`, pinning Vite to `^6`, manual electron binary, the Vite `net use` patch, and running electron-vite directly via `node`).

## Usage

1. **Authenticate** — on first launch pick subscription (recommended if already logged into Claude Code), setup-token, or API key.
2. **Chat** — choose model / effort / permission in the sidebar, type in the composer, `Enter` to send (`Shift+Enter` for newline). `/` opens the slash-command menu. `↑` recalls history.
3. **Squad** — switch to the **SQUAD** tab, load a preset or add agents (2–6), type a broadcast task (or per-agent tasks), and hit **Run All**. Each agent streams into its own panel with live cost and context %. Agents default to PLAN; raising any to AUTO-EDIT/YOLO shows a conflict warning (concurrent same-folder edits can collide).
4. **Slash commands** — SDK commands (`/usage`, `/context`, …) run as prompts; REPL-only ones (`/model`, `/help`) are handled in-app to mirror the Claude Code CLI.

## Project structure

```
src/
  main/
    index.ts      BrowserWindow (frameless) + IPC handlers
    agent.ts      SDK runner — runStreaming() is per-runId & concurrency-safe
    auth.ts       auth status/modes; resolveAuthEnv() strips API key in sub mode
    persona.ts    custom system prompt (append | replace)
  preload/
    index.ts      window.forge bridge (auth, agent, persona, window)
  renderer/src/
    App.tsx       all UI: TitleBar, MainShell, Composer (CHAT), SquadView (SQUAD)
    styles.css    theme vars + layout (amber/dark, Pretendard)
    components/   AuthGate, Md (markdown)
electron.vite.config.ts
```

## Privacy & safety

- **Local-only / BYO key.** Your credentials and conversation content stay on your machine; nothing is sent to third-party servers.
- The Claude Agent SDK's **safety guardrails are intentional and kept intact** — Forge is built entirely on the official SDK, not on any modified or de-guardrailed source.

## License

MIT
