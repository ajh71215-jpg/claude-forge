<div align="center">

# ⚒ Claude Forge

**A daily-driver desktop GUI for the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).**

Stream agentic work in a dark amber blacksmith workshop — concurrent multi-conversation **Chat**, a live **Agents** dashboard, a **Cost & Cache** observatory, and an **Extend** console over your `.claude/` config.

Electron · TypeScript · React · electron-vite · local-only · BYO key

</div>

---

## Overview

Claude Forge wraps `@anthropic-ai/claude-agent-sdk` in a native desktop app so you can run agentic conversations with live streaming of thinking, tool calls, and responses — without living in a terminal. It reuses your existing **Claude subscription login**, runs everything **locally**, and never sends your keys or content to any third-party server.

The app has five primary views — **Chat**, **Agents**, **Cost**, **Extend**, **Guide** — plus an optional desktop pet ("Clawd") in its own frameless window, and a **Cmd/Ctrl+K command palette**.

## Features

- **Live streaming** — thinking, tool-use cards, and text render as the agent works, with spinners and elapsed timers on running tools.
- **Concurrent conversation tabs** — Chat is a tab bar (up to 5). Each tab is an independent conversation with its **own isolated workspace**, so multiple agents can run at once but never edit the same files. Switching tabs never interrupts a running conversation.
- **Three auth modes** — Claude **subscription** (reuses your `~/.claude` login), setup-token, or API key. In subscription mode the app strips any `ANTHROPIC_API_KEY` so your plan is used.
- **Model & effort control** — Opus 4.8 (1M), Sonnet 4.6, Haiku 4.5, or any arbitrary model ID (`/model claude-opus-4-6`, just like the CLI). Effort `auto → low → medium → high → xhigh → max`.
- **Permission modes** — `PLAN` (read-only), `ASK` (approve each tool), `AUTO-EDIT` (auto-approve edits), `YOLO` (bypass). `AskUserQuestion` surfaces as an in-app modal.
- **Sessions** — conversations list with **resume** and full **transcript restore**; `/compact` to summarize older context and free tokens.
- **Composer niceties** — prompt history (`↑`/`↓`), message actions (copy / retry / edit), drag-drop image attach + clipboard paste, transcript search (`Ctrl/Cmd+F`), slash-command menu with unknown-command feedback, and conversation **export** (Markdown / JSON).
- **Conversation management** — rename / pin / delete conversations in the sidebar, **search across all conversations**, and **per-conversation model & persona overrides**.
- **Workspace file browser** — browse the files an agent created or edited in a conversation's isolated workspace (a pure local fs read — no model, no tokens).
- **Settings panel & shortcuts** — a consolidated Settings panel (LIMITS / persona / pet / auth — gear in the sidebar or via the palette) and a keyboard-shortcut help overlay (`Cmd/Ctrl+/`).
- **`/goal [max] <objective>`** — a Forge-native autonomous loop that resumes the session each turn until the goal is achieved / an iteration cap / a cumulative USD budget, with a live goal banner.
- **Magic keywords** — typing `ralph`, `ultrathink`, `code-review`, and friends activates an orchestration mode for the run (with false-positive guards), shown as chips.
- **Agents dashboard** — a live agent-activity view: agent cards with current action + elapsed, an expandable per-agent **tool timeline** (Read/Bash/Write/…), native **subagent** lifecycle/usage with nested inner tools, verifier provenance (🔧 tool oracle / ⚖ judge), and a persisted **History**. Pure local capture — zero extra tokens.
- **Cost & Cache dashboard** — per-run token/cache/cost aggregation: total cost, **prompt-cache hit %**, token totals, and a per-run breakdown table.
- **Extend console** — a GUI over the filesystem `.claude/`: Skills, Commands, Hooks, MCP servers, Agents, Plugins, **Providers**. (Secrets-bearing config — MCP, plugins, skill toggles, provider keys — stay in Forge-private `forge-*.json`, out of model-readable `.claude/`.)
- **Free / multi-provider delegation** *(experimental — needs a provider key)* — register free non-Anthropic models (OpenRouter / Gemini / Groq / Ollama, or any goose-supported provider) under **Extend → Providers**; the orchestrator Claude then offloads simple subtasks to them via a `delegate` tool (driven by [goose](https://github.com/block/goose)) so easy work costs $0, with automatic 429/quota fallback across providers. Design + status in [`docs/GOOSE_INTEGRATION.md`](./docs/GOOSE_INTEGRATION.md). **Note:** delegated subtask content is sent to that provider — not local-only.
- **Guide** — a first-run feature tour with inline links into each tab.
- **Desktop pet ("Clawd")** — an optional frameless, transparent, draggable window that animates in reaction to agent activity. Toggleable + persisted.
- **MCP server status**, **subscription usage %** panel, custom **persona/system prompt**, **token optimization** (cache-stable prompts, difficulty routing, cascade), **Pretendard** font, frameless custom titlebar + themed scrollbar.

## Orchestration engine

Under the hood Forge ships a pure, headless-testable **orchestration core** (conductor / topology / routing / verifier / toolVerifier / roles / keywords / loop / eval). It runs **blueprint-first deterministic DAG execution**: Forge owns the plan skeleton (validated before any spend, with a hard budget cap), and the model only picks tactics inside the plan's bounds. Subtasks default to **read-only**; only explicit write-capable roles may mutate the workspace. Verification prefers an objective **tool oracle** (typecheck/test/build) over an LLM judge. The whole core is provable without a live subscription via `npm run selftest`.

## Tech stack

| Layer | What |
|---|---|
| **main** (Node) | `@anthropic-ai/claude-agent-sdk`, window + IPC glue, auth, per-runId streaming runner, orchestration core, agent-activity store, desktop-pet lifecycle |
| **preload** | context-isolated `window.forge` bridge |
| **renderer** | React + `react-markdown`, decomposed into `components/` + `lib/`; CSS split into `styles/` partials |
| **bundler** | electron-vite (Vite 6) |

## Getting started

### Prerequisites
- **Node.js** 20+ (developed on 24.x)
- An active **Claude subscription** logged in via Claude Code (`~/.claude`), or an Anthropic API key.

### Install & run (standard environment)
```bash
npm install
npm run dev          # electron-vite dev — launches the app with HMR
npm run dev:web      # browser-only design preview (no Electron/SDK; window.forge mocked) → http://localhost:5199
```

### Build a production bundle
```bash
npm run build        # → out/
npm run start        # preview the built app
```

### Quality gates
```bash
npm run typecheck    # tsc --noEmit
npm run selftest     # headless orchestration-core correctness check (~94 assertions, no live session)
npm run test         # pure renderer-lib unit tests (node:test — no DOM/Electron/SDK)
npm run lint         # eslint
npm run format       # prettier --write
```

> **Building on a locked-down Windows machine?** If `cmd.exe` is blocked, esbuild gets quarantined by AV, or the electron binary won't extract, run `bash bootstrap/install.sh` for one-step recovery — or see **[CLAUDE.md](./CLAUDE.md)** for the exact manual workarounds (`--ignore-scripts`, pinning Vite to `^6`, manual electron binary, the Vite `net use` patch, and running electron-vite directly via `node`).

## Usage

1. **Authenticate** — on first launch pick subscription (recommended if already logged into Claude Code), setup-token, or API key.
2. **Chat** — choose model / effort / permission in the sidebar, type in the composer, `Enter` to send (`Shift+Enter` for newline). `/` opens the slash-command menu, `↑` recalls history, `Ctrl/Cmd+F` searches the transcript. Open more tabs (up to 5) to run independent conversations side by side. Use `/goal` for an autonomous loop, or a magic keyword to trigger an orchestration mode.
3. **Agents** — watch live agent cards and subagent activity; click a card to expand its tool timeline. The History list persists past runs with cost / duration / verifier provenance.
4. **Cost** — review aggregate spend, prompt-cache hit %, and a per-run token breakdown.
5. **Extend** — manage Skills, Commands, Hooks, MCP servers, Agents, and Plugins from a GUI.
6. **Slash commands** — SDK commands (`/usage`, `/context`, …) run as prompts; REPL-only ones (`/model`, `/help`) are handled in-app to mirror the Claude Code CLI; unknown commands get a clear notice.

## Project structure

```
src/
  main/
    index.ts          thin shell: frameless BrowserWindow + registerAll(ipc) + initPet + initActivity
    agent/            SDK runner — runStreaming() is per-runId & concurrency-safe (+ subtask/usage/sessions/...)
    ipc/              per-domain IPC handlers (auth, agent, persona, extend, orchestrate, activity, window, pet, workspace)
    workspace.ts      pure local fs read of a conversation's isolated workspace (backs WorkspaceFiles)
    orchestration.ts  pure data contracts + graph helpers   } the headless-testable
    conductor.ts      plan validation + DAG executor        } orchestration core
    topology.ts routing.ts verifier.ts toolVerifier.ts      } (npm run selftest)
    roles.ts keywords.ts loop.ts eval.ts                    }
    agentActivity.ts  agent-activity store (backs the Agents dashboard; zero extra tokens)
    auth.ts persona.ts  + per-feature EXTEND backends (skills/commands/hooks/mcp/agents/plugins)
    pet/              desktop-pet window + state machine + event bus
  preload/
    index.ts          window.forge bridge       pet.ts  pet-only window.pet bridge
  renderer/src/
    App.tsx           shell + MainShell (sidebar/usage/caps + view routing)
    components/       chat/ (thin Composer + co-located hooks) squad/ cost/ extend/ guide/ persona/ palette/
                      + TitleBar, AuthGate, Md, Sidebar, Settings, WorkspaceFiles, ConversationSearch, ShortcutsHelp
    lib/              pure, tested helpers/types (blocks, format, export, goal, slashCommands, composer, storage, ...)
    styles/           CSS partials (00-core … 08-palette); styles.css is just the @import index
  renderer/pet/       plain-JS pet renderer (no React)
electron.vite.config.ts
```

## Privacy & safety

- **Local-only / BYO key.** Your credentials and conversation content stay on your machine; nothing is sent to third-party servers. MCP servers, plugins, and skill toggles live in Forge-private `forge-*.json` so secrets stay out of model-readable `.claude/`. **Exception:** if you opt into **free-provider delegation** (Extend → Providers), the content of delegated subtasks *is* sent to that provider — disabled until you add a provider.
- The Claude Agent SDK's **safety guardrails are intentional and kept intact** — Forge is built entirely on the official SDK, not on any modified or de-guardrailed source.

## License

MIT
