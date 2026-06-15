# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Claude Forge

Project guidance for Claude Code working in this repo. Read before building, running, or editing.

## What this is
**Claude Forge** — an Electron desktop GUI wrapper over `@anthropic-ai/claude-agent-sdk`. A daily-driver "forge" for agentic work with a dark amber blacksmith theme. Electron + TypeScript + React, bundled by **electron-vite**. Three layers: `main` (Node), `preload` (bridge), `renderer` (React).

BYO-key / subscription, **local-only** — secrets never leave the machine to any third-party server. Auth supports Claude **subscription** (reuses `~/.claude` login), setup-token, or API key.

The app has three primary views (`view: 'chat' | 'squad' | 'extend'`) plus an optional **desktop pet** ("Clawd") in its own frameless window.

## Architecture map

The main process splits into thin **orchestration/IPC glue** + a **pure, headless-testable orchestration core** + per-feature backends.

### Core SDK runner — `src/main/agent/` (formerly the monolithic `agent.ts`, now a directory; barrel `index.ts` re-exports the identical public surface)
- `runStreaming.ts` — `runStreaming(sender, runId, prompt, opts)`, **per-runId and concurrency-safe** (active Map keyed by runId; every emitted `AgentEvent` carries `runId`). Maps STOP→`q.interrupt()`, ASK→`permissionMode:'default'` + `canUseTool` round-trip. Also emits every event into `pet/bus.ts` so the pet can react. Wires the EXTEND features into the SDK: `settingSources:['user','project']`, `skills`, `mcpServers`, `plugins`, plus per-run `systemPrompt`.
- `subtaskRunner.ts` — `runSubtaskQuery(...)`: headless single-shot SDK call (no renderer streaming) used by the orchestration engine as the live model-call adapter. **Read-only by default** (`canUseTool` allows only `Read/Grep/Glob/WebFetch/WebSearch/TodoWrite`); write-capable roles opt into `WRITE_TOOLS`, but `Task` (recursive spawn) and `AskUserQuestion` (human block) stay denied always.
- `capabilities.ts`/`usage.ts`/`sessions.ts`/`compact.ts`/`control.ts` — `getCapabilities` / `getUsage` / `getSessions` + `getTranscript` / `compactSession` / `respondPermission` + `respondDialog` + `interruptRun`. Control methods (`supportedModels`/`supportedCommands`/`mcpServerStatus`) resolve **without** iterating the stream.
- `env.ts` — `buildEnv`, `ensureWorkspace`, `SETTING_SOURCES`, `workspaceDir`. `helpers.ts` — `singlePrompt`, `resultErrorMessage`, tool-content stringifiers. `state.ts` — shared `active`/`pendingPerms`/`pendingDialogs` maps. `types.ts` — all SDK-facing types (`RunOptions`, `AgentEvent`, `Capabilities`, `UsageInfo`, …).

### Orchestration core — pure, no electron/SDK imports → **headlessly unit-testable** via `npm run selftest`
These modules own the deterministic plan logic; live model calls are **injected** via `deps`, so the control flow is provable without a subscription. Design is documented in `docs/SQUAD_ORCHESTRATION.md`; the validated mechanism is *blueprint-first deterministic DAG execution* (Forge owns the skeleton; the model only picks tactics inside the plan's bounds).
- `orchestration.ts` — data contracts (`Plan`, `Subtask`, `Topology`, `ModelTier`, `Artifact`, `Verdict`) + pure graph helpers (`topoSort`, `deriveDeps`, enum tables).
- `conductor.ts` — `validatePlan` (rejects bad plans before any spend: unique ids, acyclic DAG, known enums, non-empty rubric, positive budget), `executePlan` (topological DAG executor with verify→revise, cascade escalation, per-step checkpoints, hard budget cap), `projectPlanCost`.
- `topology.ts` — per-subtask executors: `single`, `fanout` (best-of-N chosen by the **verifier**, not the generator), `self_consistency` (vote with early-stop), `debate` (multi-round panel), `cascade` (escalate tier only after an external failure).
- `routing.ts` — single owner of the model router / cascade ladder (`haiku→sonnet→opus`). Both the cost optimizer and the conductor import from here so routing policy is never duplicated. Heuristic difficulty classifier is a tunable default, not an oracle.
- `verifier.ts` — LLM-judge aggregation with bias mitigation (confidence-weighted voting, pairwise order-swap, debate convergence, early-stop). Ties always resolve to **FAIL**.
- `toolVerifier.ts` — the **preferred** verifier: an objective tool oracle (typecheck/test/build) → `Verdict`. No model needed; command runner injected for testability.
- `roles.ts` — native registry of **19 agent roles** distilled from oh-my-claudecode's `agents/*.md` (persona + default tier + `writeCapable` builder/advisor gate). The conductor uses `writeCapable` to pick the subtask tool gate.
- `keywords.ts` — native magic-keyword detector (port of OMC's `keyword-detector` hook): maps a typed goal to an orchestration mode (`loop`/`parallel`/`reason`/`role`/`cancel`) with OMC's false-positive guards (don't fire when the user is merely *talking about* the keyword).
- `loop.ts` — `runLoop`: thin outer loop over `executePlan` that re-runs the plan until every subtask's goal verdict passes / iteration cap / budget exhausted; passed subtasks are cached cross-iteration (OMC's "ralph/autopilot, the boulder never stops").
- `eval.ts` — golden-set scoring + **same-compute baseline delta** + the §8 kill-criteria gate (`gateVerdict`). The meaningful comparison is orchestrated vs a single agent given the **same** token budget. Golden set: `eval/golden-set.json` (53 tasks).

### IPC + window — `src/main/index.ts` (thin: ~64 lines) + `src/main/ipc/`
- `index.ts` — creates the frameless `BrowserWindow` (custom titlebar), calls `registerAll(ipcMain)`, and `initPet()`. Set `FORGE_CDP=<port>` to enable remote debugging. Dev loads `ELECTRON_RENDERER_URL`; prod `loadFile(out/renderer/index.html)`.
- `ipc/index.ts` — `registerAll` fans out to domain modules, each owning its own `ipcMain.handle` channels: `auth.ts`, `agent.ts`, `persona.ts`, `extend.ts`, `orchestrate.ts`, `window.ts`, `pet.ts`.
- `ipc/orchestrate.ts` — drives the orchestration core. Channels: `orchestrate:dry-run` (simulated, no model — proves renderer↔main↔conductor without a subscription), `orchestrate:run` (live read-only `runSubtaskQuery` samples + cheap haiku rubric judge), `orchestrate:run-loop`, `orchestrate:validate`, `orchestrate:roles`, `orchestrate:detect-keywords`. Streams `OrchestrateEvent`s to the Squad Blackboard monitor.

### Per-feature EXTEND backends — `src/main/{skills,commands,hooks,mcp,agents,plugins}.ts`
Plus shared `frontmatter.ts` (YAML frontmatter parse/serialize) and `projectSettings.ts` (`.claude/settings.json` read/write). Source of truth is the filesystem `.claude/` (skills/commands/agents files, settings.json hooks) **except** MCP servers, plugins, and skill-toggles, which live in Forge-private `forge-{skills,mcp,plugins}.json` so secrets stay out of model-readable `.claude/`.

### Auth + persona — `src/main/auth.ts`, `src/main/persona.ts`
- `auth.ts` — auth status + mode switching. `resolveAuthEnv()` **strips `ANTHROPIC_API_KEY`** in subscription mode (an API key would otherwise outrank the subscription).
- `persona.ts` — global custom system prompt (`append` | `replace` modes).

### Desktop pet ("Clawd") — `src/main/pet/` + `src/renderer/pet/` + `src/preload/pet.ts`
A separate frameless, transparent, draggable window that animates in reaction to agent activity.
- `pet/index.ts` — enable/disable lifecycle, persists the preference, restores on launch (`initPet`). `pet/petWindow.ts` — window + drag/interactive hit-test. `pet/petState.ts` — state machine driven by agent events. `pet/bus.ts` — leaf event bus tapped by `runStreaming` (type-only import, no cycle). `pet/protocol.ts` — registers the privileged `pet://` asset scheme (must run before app `ready`). `pet/paths.ts`, `pet/petState.ts`, `pet/protocol.ts`.
- `src/renderer/pet/` — plain-JS renderer (`index.html` + `pet.js` + `pet.css`), no React. `src/preload/pet.ts` — tiny pet-only `window.pet` surface (state in, drag/interactive out).

### Preload — `src/preload/index.ts`
Exposes `window.forge` = `{ auth, agent.{start,interrupt,respondPermission,respondDialog,capabilities,sessions,usage,transcript,compact,onEvent,onCompactProgress}, persona, skills, commands, hooks, mcp, agents, plugins, orchestrate.{dryRun,run,runLoop,validate,roles,detectKeywords,onEvent}, window, pet }`. The pet window has its own preload (`pet.ts` → `window.pet`).

### Renderer — `src/renderer/src/` (App.tsx decomposed into `components/`, per `docs/MAINTAINABILITY.md`)
- `App.tsx` (~580 lines) — shell + `MainShell` (sidebar/usage/caps/session state + `view` routing). No longer monolithic.
- `components/` — `TitleBar.tsx`, `AuthGate.tsx`, `Icon.tsx`, `Md.tsx` (markdown), and subfolders:
  - `chat/` — `Composer`, `TurnView`, `BlockView`, `HistoryView`, `PermissionModal`, `QuestionModal` (AskUserQuestion via `canUseTool`), `TodoBar`/`TodoList` (reconstructed from Task tools), `useAgentEvents` (event routing hook, keyed by `runId`).
  - `squad/SquadView.tsx` — the Squad tab, **redesigned as an orchestration dashboard** (plan editor + live Blackboard monitor of each subtask's tier/work-rate/verdict). The legacy "run N independent agents" manual fan-out was removed; hand-assignment survives only as a "Manual assign" toggle. All form controls are custom (no native `<select>`/`<checkbox>`) for cross-OS consistency.
  - `extend/` — `ExtendView` + `SkillsPanel`/`CommandsPanel`/`HooksPanel`/`McpPanel`/`AgentsPanel`/`PluginsPanel` + `shared.ts`. Each panel only calls `window.forge` IPC (near-zero coupling).
  - `persona/PersonaModal.tsx`.
- `lib/` — pure helpers/types: `blocks.ts` (`reduceBlocks`), `format.ts`, `constants.ts` (`EFFORTS`/`PERMS`), `types.ts`.
- `styles.css` (~3700 lines) — theme vars (`--bg #0b0a09`, `--amber #e8932a`, Pretendard mono) + all layout, imported from `main.tsx`.

### Vendored reference — `new_folder/oh-my-claudecode/`
A **read-only checked-in copy** of the upstream `oh-my-claudecode` project, kept purely as the **reference source** for the native ports in `roles.ts` / `keywords.ts` / `loop.ts`. It is not built or imported by the app. Don't ship features by depending on it at runtime — port the portable core into pure Forge modules.

## Commands
A `.npmrc` sets `script-shell` to Git Bash and every `package.json` script invokes its tool through an explicit `node node_modules/.../bin` path, so `npm run <script>` works even on the locked-down Windows box (it no longer routes through the blocked `cmd.exe`). On the Windows env, prefix with the PATH export (see below).

```bash
npm run dev          # electron-vite dev — window on desktop; 4 electron procs = healthy
npm run dev:web      # browser-only DESIGN PREVIEW of the renderer (vite, no Electron/SDK; window.forge mocked) → http://localhost:5199
npm run build        # production build → out/
npm run start        # preview the built app (electron-vite preview)
npm run typecheck    # tsc -p tsconfig.json --noEmit
npm run selftest     # compile tsconfig.selftest.json → out-selftest, then run the headless orchestration self-test
npm run lint         # eslint src --ext .ts,.tsx
npm run format       # prettier --write src
```

- **`npm run selftest`** is the cheap, always-available correctness check for the orchestration core: `scripts/orchestration-selftest.cjs` exercises DAG order, verify→revise cascade, budget hard-cap, plan-validation gate, judge-bias-mitigated voting, roles/keywords/loop — all with **injected stub model calls**, no live session. Run it after touching anything under the orchestration core. (~94 assertions.)
- **Live/CDP verification drivers** (need a real subscription session, cost money): `scripts/cdp.mjs` + `scripts/cdp-shot.mjs` (CDP), `scripts/live-orch.js` / `live-smoke.js` / `live-warm.js` (orchestration + token-cache realism), `EVAL_LIVE=1 node scripts/eval.mjs` (orchestrated-vs-baseline eval run loop), `scripts/perf-*.js` (paste/stream/frame perf), `scripts/smoke.mjs` (SDK concurrency).

ESLint config: `.eslintrc.json` (`@typescript-eslint` + `react-hooks`; `no-explicit-any`/`no-unused-vars`/`no-console` are warnings). Prettier: `.prettierrc.json` (no semis, single quotes, width 100, no trailing comma, LF).

## Build & run — locked-down Windows env (REQUIRED workarounds)
This machine fights the Node/Electron toolchain, **and resets on reboot** (frozen/non-persistent — tools and deps vanish). `bootstrap/` automates full recovery; the manual notes below explain *why* each workaround exists when you need to debug or reapply one.

**Fast path after a reset:** run `bootstrap/setup.exe` (downloads Node + PortableGit, then runs `install.sh`), or from any Git Bash: `bash bootstrap/install.sh` (idempotent; prints `[bootstrap] …` per step). It installs PowerShell 7 + Claude Code and restores deps with all patches applied. See `bootstrap/README.md`.

The individual hurdles `install.sh` handles for you:

1. **Node** is at `C:\Users\CKIRUser\tools\node` (manual install, no admin). The Bash tool does **not** source `~/.bashrc`, so prefix every command:
   `export PATH="/c/Users/CKIRUser/tools/node:$PATH"`
2. **cmd.exe and PowerShell 5.1 are blocked** (spawn EPERM −4048). npm lifecycle scripts run via cmd.exe → fail. Install with **`npm install --ignore-scripts`**.
3. **AV quarantines some esbuild binaries** (0.27.x deleted seconds after landing; 0.25.12 survives). Keep `vite` pinned to **`^6`** and `@vitejs/plugin-react` to `^4`. Don't hand-place esbuild.exe.
4. **electron binary**: `--ignore-scripts` skips it and its extract-zip fails (DLOPEN). Fetch manually: download `electron-v<ver>-win32-x64.zip` from GitHub releases, `unzip` into `node_modules/electron/dist`, then `printf 'electron.exe' > node_modules/electron/path.txt` (use **printf, not echo** — a trailing newline → `electron.exe\n` → ENOENT).
5. **vite patch** (`bootstrap/patch-vite.mjs`): vite calls `exec("net use")` (→ cmd.exe) for network-drive realpath. In `node_modules/vite/dist/node/chunks/dep-*.js` replace the `exec("net use", ...)` block with `safeRealpathSync = fs__default.realpathSync.native;`. Lost on `npm install`; reapply (the patch script does this).

**Raw commands** (when not using `npm run`; Bash tool, sandbox disabled for spawns that launch electron):
```bash
export PATH="/c/Users/CKIRUser/tools/node:$PATH"
node node_modules/electron-vite/bin/electron-vite.js dev      # run
node node_modules/electron-vite/bin/electron-vite.js build    # build → out/
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit   # typecheck
```

## Shell — tool routing priority (STRICT)
Run **every** command through this fallback chain, in order. Do not skip to a lower tier unless the one above genuinely can't do the job.

1. **Git Bash (PRIMARY)** — `C:\Users\CKIRUser\PortableGit\bin\bash.exe`. This is the only reliable shell here; `.npmrc` already points `script-shell` at it. **Launch Claude Code itself from a Git Bash terminal** so the harness exposes a working Bash tool (the default PowerShell tool below is dead). The Bash tool does **not** source `~/.bashrc` — prefix commands with `export PATH="/c/Users/CKIRUser/tools/node:$PATH"` (see the env-workarounds section).
2. **PowerShell 7 / pwsh (FALLBACK)** — `C:\Users\CKIRUser\Downloads\PowerShell-7.6.2-win-x64\pwsh.exe`, i.e. `/c/Users/CKIRUser/Downloads/PowerShell-7.6.2-win-x64/pwsh -NoProfile -Command "..."`. Use **only** for things Git Bash can't do: process management (`Get-Process electron,node | Stop-Process -Force` — `tasklist`/`wmic` don't reliably see the manually-placed `electron.exe`) and Win32/`Add-Type` screenshots.
3. **❌ NEVER PowerShell 5.1 (`powershell.exe`) or `cmd.exe`** — both are **blocked** on this machine and fail with `EPERM −4048 (uv_spawn)`. The harness's built-in "PowerShell" tool maps to 5.1, so it is unusable; never route a command through it.

## Verifying UI changes (do this — screenshots/measurements alone mislead)
Renderer verification is hard here: HMR is unreliable, and **zombie dev/electron instances from prior sessions cause stale-render confusion**. Procedure:
1. **Kill everything first**, then start ONE: `pwsh ... "Get-Process electron,node | Stop-Process -Force"`.
2. For fast layout/theme iteration WITHOUT Electron or a live key, use **`npm run dev:web`** (browser preview with a mocked `window.forge`). For ground truth of real behavior, build and run prod with CDP:
   `FORGE_CDP=9222 ./node_modules/electron/dist/electron.exe .` (or `--remote-debugging-port=9222`).
3. Probe **computed styles** via a Node script (Node 24 has global `WebSocket`): `fetch http://127.0.0.1:9222/json` → connect `webSocketDebuggerUrl` → `Runtime.evaluate` running `getComputedStyle(el)`. This is authoritative; `document.title` box-measurement hacks proved unreliable. Reusable drivers: `cdp-extend.mjs`, `scripts/cdp.mjs`, `scripts/cdp-shot.mjs`.
4. For occlusion-free screenshots use Win32 **`PrintWindow(hwnd, hdc, 2)`** (PW_RENDERFULLCONTENT) via `Add-Type` in pwsh (`scripts/shot.ps1`) — not `CopyFromScreen` (a foreground terminal overlaps it).

## Packaging a distributable `.exe` (electron-builder)
Config: `electron-builder.yml` (target **nsis** installer; `asar: false`). The build also emits the **pet** preload + renderer entries (see `electron.vite.config.ts` — two `input`s each for preload and renderer). Build the renderer first (`electron-vite build` → `out/`), then run electron-builder via node (use the explicit node path for the `.bin` shim):
```bash
node node_modules/electron-builder/cli.js --win --dir   --publish never   # unpacked → dist/win-unpacked/Claude Forge.exe (fast, for testing)
node node_modules/electron-builder/cli.js --win nsis --publish never       # installer → dist/Claude Forge Setup <ver>.exe
```
Two env-specific hurdles (`bootstrap/patch-app-builder.mjs` handles the first; both are lost on `npm install` — reapply like the Vite patch):
1. **Collector patch** — electron-builder 26's node-module collector spawns `powershell.exe -EncodedCommand` to run `npm list`; here `powershell.exe`/`cmd.exe` are blocked → `spawn powershell.exe ENOENT`, build fails. Patched `node_modules/app-builder-lib/out/node-module-collector/nodeModulesCollector.js` (the `streamCollectorCommandToFile` win32 branch) to run npm directly via `node <node-dir>/node_modules/npm/bin/npm-cli.js` instead.
2. **`asar: false`** — the Agent SDK spawns its bundled `claude.exe` by on-disk path; inside an asar archive that path isn't executable (renderer shows *"claude.exe exists but failed to launch"*). With asar off, `claude.exe` is a real file at `resources/app/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` and spawns fine. NSIS/winCodeSign/7z downloads from GitHub releases worked here (not AV-blocked). Verify a packaged build by launching `dist/win-unpacked/Claude Forge.exe` with `FORGE_CDP=9222` and driving a test prompt via CDP — confirm a real reply, not the launch error.

## Gotchas
- **CSS unclosed-brace footgun**: a single stray `{` in `styles.css` makes modern Chromium's **CSS nesting** swallow ALL following rules as descendants — they silently stop matching (e.g. a dangling `.session-cost {` once broke the entire CHAT layout). After editing CSS, sanity-check brace balance: `grep -o '{' styles.css | wc -l` must equal `grep -o '}' ...`.
- **Flexbox height**: in a flex column, prefer `flex: 1; min-height: 0` over `height: 100%` for fill children (percentage height resolution against flex items is fragile in Chromium).
- **Inline styles** (`style={{ display: ... }}`) override CSS class rules — watch for `'block'` vs `'flex'` clobbering layout.
- **Subscription thinking text** is **encrypted/empty on Opus 4.8** but **visible on Sonnet 4.6**.
- SDK **slash commands** (`/usage`, `/context`, …) execute when sent as the prompt; REPL-only ones (`/model`, `/help`) are handled client-side in the renderer.
- **Pet protocol ordering**: `pet/protocol.ts` registers `pet://` as a privileged scheme, which must happen **before** app `ready` — `index.ts` imports the pet module for this side effect. Don't lazy-import it.
- **Orchestration purity**: anything imported by `tsconfig.selftest.json` (the orchestration core) must stay free of electron/SDK imports, or `npm run selftest` breaks. Inject live model calls via `deps`, never import them.

## Constraints (do NOT violate)
- **Never port `C:\Users\CKIRUser\Downloads\free-code-main`.** It is leaked Anthropic Claude Code source with safety guardrails stripped. Build every feature from scratch via the official SDK. (The SDK's safety guardrails are intentional and must stay intact.)
- Keep it **local-only / BYO-key**; never send secrets or user content to a third-party server.
- Squad / orchestration subtasks default to **read-only** (`subtaskRunner` tool gate). Only explicit write-capable roles (`roles.ts`) may mutate the workspace; `Task` and `AskUserQuestion` are always denied to subtasks. The global **max $/run** budget cap is enforced by the conductor's budget governor (N subtasks multiply cost — the governor projects spend before each step and hard-stops).
- MCP servers, plugins, and skill-toggles must stay **out of `.claude/`** (in Forge-private `forge-*.json`) so secrets aren't model-readable.
- `new_folder/oh-my-claudecode/` is **vendored reference only** — port its ideas into pure Forge modules; don't import or build it at runtime.
- Orchestration honesty: the eval (`eval.ts`/`scripts/eval.mjs`) compares orchestrated vs single-agent at the **same compute budget**. Winning by spending more is not a win — keep `gateVerdict` honest and don't cherry-pick task mixes.

## Status
8-step app complete and running. Done: subscription auth, transcript restore, prompt history, message actions, image attachment, subscription **usage %** panel, token-optimization tiers 1–4, Pretendard font, arbitrary `/model <id>`, custom titlebar/scrollbar.

**EXTEND tab — COMPLETE** (`docs/ROADMAP.md`). GUI console over the filesystem `.claude/`: Skills, Commands, Hooks, MCP, Agents, Plugins. Also landed: **AskUserQuestion** routes via `canUseTool` (renders QuestionModal) and the pinned **TODO bar** reconstructs from Task tools.

**SQUAD redesigned as a deterministic orchestration dashboard** (`docs/SQUAD_ORCHESTRATION.md`). The pure orchestration core (conductor / topology / routing / verifier / toolVerifier / roles / keywords / loop / eval) is complete and proven headlessly (`npm run selftest`). Live adapter (`orchestrate:run` + `runSubtaskQuery` read-only samples + haiku judge) verified end-to-end with real subscription calls; remaining work is **scale-fill measurement** (full 53-task eval, prod frame-time tracing) — see `docs/PROGRESS.md`. Native ports of oh-my-claudecode's roles/keywords/loop are wired into the engine.

**Desktop pet ("Clawd")** — optional frameless transparent window that animates to agent activity (`src/main/pet/`, `src/renderer/pet/`), toggleable + persisted.

**Maintainability refactor** (`docs/MAINTAINABILITY.md`) — behavior-preserving decomposition done: `agent.ts`→`agent/`, `index.ts`→thin shell + `ipc/`, monolithic `App.tsx`→`components/` + `lib/`.

**Tooling/infra:** ESLint + Prettier configured; `bootstrap/` provides one-step environment recovery for the reset-on-reboot machine; `npm run dev:web` gives a no-Electron browser design preview; `npm run selftest` is the standing headless correctness gate for the orchestration core.

## Docs (under `docs/`)
- `SQUAD_ORCHESTRATION.md` — orchestration design + evidence ledger (validated-mechanism grading).
- `TOKEN_OPTIMIZATION.md` — cost levers (caching, difficulty routing, cascade).
- `MAINTAINABILITY.md` — the behavior-preserving file-decomposition plan.
- `PERFORMANCE.md` — render/stream/paste perf levers + measurements.
- `ROADMAP.md` — the (completed) EXTEND extensibility roadmap.
- `PROGRESS.md` — live status ledger; the honest record of what's measured vs. still pending.
