# Claude Forge — Extensibility Roadmap

Turn Forge from a chat/Squad client into a **GUI extension console** over the
Claude Code engine: author and manage Skills, Hooks, slash Commands, subagents,
and MCP servers visually — the same primitives the CLI exposes through files.

> Grounded in the installed `@anthropic-ai/claude-agent-sdk` types. The SDK
> `Options` already supports everything below:
> `hooks`, `skills: 'all' | string[]`, `agents`, `mcpServers`, `plugins`,
> `settingSources`, `canUseTool`.

> **Progress:** ✅ **Roadmap complete.** Phase 0 (settingSources + stable
> workspace) plus all six features ship in the **EXTEND** tab:
> ✅ #1 Skills · ✅ #2 Hooks · ✅ #3 Commands · ✅ #4 MCP · ✅ #5 Agents ·
> ✅ #6 Plugins. Each is filesystem-backed (`.claude/` or a Forge-private
> `forge-*.json`) and wired into the SDK run/capabilities options. Verified
> end-to-end via CDP (UI → IPC → on-disk).

## Prerequisite — Phase 0: enable `settingSources` (small, unblocks all)
**Current state:** `src/main/agent.ts` does **not** set `settingSources`, so the
SDK runs hermetic and **ignores the filesystem `.claude/`** (skills, commands,
agents, settings/hooks/mcp are never discovered).

- In `runStreaming` options, add:
  ```ts
  options.settingSources = ['user', 'project']   // discover .claude/ skills·commands·agents·settings
  ```
- Establish a per-run **project `.claude/`** working dir (reuse the existing
  `cwd` plumbing). Decide scope: project `.claude/` (portable, git-syncable) vs
  user `~/.claude/` (note: this machine wipes `~` on reboot — prefer project).
- One change → Skills, Hooks, Commands, Agents all light up at once.

---

## Prioritized features

### 1. 🧩 Skills
- **SDK wiring:** `settingSources:['project']` + `skills: 'all' | [enabled names]`
  (a context filter — unlisted skills are hidden, not sandboxed).
- **Forge UI:** a `SKILLS` panel — list discovered skills (name · description ·
  on/off), **create** (`.claude/skills/<name>/SKILL.md` with a frontmatter editor
  for `name`/`description` + Markdown body + optional bundled scripts), edit, delete.
- **Visualize:** when the agent invokes a skill, render it in the transcript
  (reuse the existing tool-card components).
- **Effort:** medium.

### 2. 🪝 Hooks
- **Two tracks:**
  - **Claude Code standard** — write `.claude/settings.json` hooks
    (event + matcher + shell command); portable and familiar.
  - **Forge-native** — register in-process SDK `hooks` callbacks (no shell):
    e.g. desktop notification on `Stop`, auto-log on `PostToolUse`.
- **Events (from SDK `HookEvent`):** `PreToolUse` (block/approve), `PostToolUse`,
  `UserPromptSubmit`, `Stop`, `SessionStart`/`SessionEnd`, `PreCompact`,
  `SubagentStart`/`SubagentStop`, `FileChanged`, … (~30 events).
- **Forge UI:** a `HOOKS` manager — pick event + matcher (tool pattern) + action;
  toggles for the native reactions. A live **hook-fire log**; surface
  `PreToolUse` block decisions in the UI.
- **Effort:** medium.

### 3. ⌨️ Custom slash commands
- **`.claude/commands/<name>.md`** generator (frontmatter: `description`,
  `argument-hint`; body = prompt template using `$ARGUMENTS`).
- **Reuses existing infra:** Forge already has the slash menu + `supportedCommands`
  — new commands auto-appear. Lowest-friction win.
- **Effort:** small.

### 4. 🔌 MCP management (read-only → CRUD)
- Upgrade the current **status-only** MCP panel to **add / edit / remove**
  servers (stdio / http / sse), persisted to `.claude/settings.json` `mcpServers`
  (or passed via the SDK `mcpServers` option).
- **Test-connect** button using the existing `mcpServerStatus` control method.
- **Effort:** medium.

---

## Later / stretch

### 5. 🤖 Reusable subagents (extends Squad)
Promote Squad's ad-hoc agents into **named, saved subagents**
(`.claude/agents/<name>.md` or the SDK `agents` option). An `AGENTS` manager;
reuse a saved agent in Chat (delegated via `Task`) and as a Squad slot.

### 6. 📦 Plugins
Support the SDK `plugins` option — install/enable a **bundle** of
skills + commands + hooks + agents from a path or marketplace. The umbrella that
packages everything above.

---

## Cross-cutting design
- **Source of truth = filesystem `.claude/`.** Forge is the editor; this keeps
  everything portable, git-syncable, and compatible with the CLI and the
  `bootstrap/` restore kit.
- **Scope toggle:** project `.claude/` (recommended — survives via git) vs user
  `~/.claude/` (wiped on reboot here).
- **Safety surfaced:** hooks and skills run real code locally — the UI must say so.
- **Home in the UI:** a new **`EXTEND`** tab (or sidebar section) grouping
  Skills / Hooks / Commands / Agents / MCP / Plugins, alongside `CHAT | SQUAD`.

## Recommended sequencing
**Phase 0 → Skills → Hooks → Commands → MCP.** Phase 0 is the unlock; Skills and
Hooks are the headline asks; Commands is cheap (reuses slash infra); MCP upgrades
an existing panel. Subagents and Plugins follow once the `.claude/` editing
foundation is solid.
