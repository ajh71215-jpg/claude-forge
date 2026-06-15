# GOOSE_INTEGRATION.md — free/multi-provider sub-agents via goose

Status: **PLAN (verified, not yet implemented)**. Goal: let Forge's orchestration delegate simple/cheap subtasks to **free or cheaper non-Anthropic models** (OpenRouter `:free`, Google Gemini free tier, Groq, local Ollama) as *full agentic* sub-agents (file edit / grep / shell), **auto-routed** so the easy work costs $0 and only failures escalate to paid Claude.

The leverage: instead of building+maintaining our own tool-calling agent loop, we drive **goose** (Block's Rust agent) — it already implements the loop, tool execution, MCP, and 40+ providers. This doc is grounded in two verified research passes (goose CLI/ACP spec + reverse-engineering `gilhyun/Octopal`, which ships exactly this pattern in Tauri).

---

## 1. Verified facts ledger (load-bearing — every design choice traces here)

### goose (Block) — confirmed against `block/goose@main` source + docs
- **Embed mode = ACP, not `goose run`.** `goose acp` runs goose as an **Agent Client Protocol** server over **stdio, newline-delimited JSON-RPC 2.0**. `goose serve` does the same over HTTP/WS (`127.0.0.1:3284`). This is the embed-friendly, long-lived alternative to per-task CLI spawns. (`goose run` one-shots exist too — `--no-session -q -t "…" --output-format json` — but ACP gives streaming + tool events + session reuse.)
- **Provider/model per-process via env**, no global config touched: `GOOSE_PROVIDER`, `GOOSE_MODEL` (or `--provider`/`--model` on `goose run`). API keys via env: Gemini=`GOOGLE_API_KEY`, OpenRouter=`OPENROUTER_API_KEY`, Groq=`GROQ_API_KEY`, Ollama=`OLLAMA_HOST` (no key), Anthropic=`ANTHROPIC_API_KEY`, OpenAI=`OPENAI_API_KEY`.
- **Permission modes** via `GOOSE_MODE`: `auto` (run all tools, headless default), `approve` (every tool needs confirmation), `smart_approve` (read-only auto, writes need confirm — **blocks in headless**), `chat` (no tool execution at all).
- **cwd**: no `--cwd` flag → uses **process cwd**. Set it on spawn.
- **Tools**: the built-in **Developer** extension exposes shell + text-editor + read-file (add via `--with-builtin developer`; MCP servers via `--with-extension`).
- **⚠️ No usage/cost in ACP.** goose ACP (v1.31 / v2.0-rc) does **not** return token counts or USD in the `session/prompt` response. Cost must be estimated by us (or read from the SQLite `sessions.db` on the non-ACP path).
- **Binary**: single static Rust exe per OS/arch. Release host is contested between docs (`block/goose` releases vs the `aaif-goose/goose` mirror referenced by `download_cli.sh`). **TODO: pin the exact host+version at integration time.** Octopal pins `v2.0.0-rc-04-27-0` from `github.com/block/goose/releases`.
- **No `session/cancel`** in the ACP version Octopal targets → cancellation = process SIGTERM/SIGKILL.

### Octopal (`gilhyun/Octopal`) — the proven integration pattern (Tauri/Rust)
- Spawns goose as a **long-lived `goose acp` sidecar, pooled per agent**, `env_clear()` then a curated env map; **fresh `session/new` per turn**.
- Per-turn JSON-RPC: `initialize {protocolVersion:1, clientCapabilities:{}}` → `session/new {cwd, mcpServers:[]}` → (optionally) `session/set_mode {sessionId, modeId}` → `session/prompt {sessionId, prompt:[{type:"text", text}]}`. Response carries `result.stopReason` (`end_turn`/`max_tokens`/`refusal`).
- **No system-prompt field in ACP** → Octopal prepends it into the user turn (`--- OCTOPAL AGENT CONTEXT … ---`).
- **XDG isolation**: sets `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_STATE_HOME` to app-private dirs so goose never touches the user's `~/.config/goose`.
- **`session/update` notifications** mapped to UI events; tool-name normalization: `developer__shell`→Bash, `developer__text_editor`→Write/Edit, `developer__read_file`→Read, `developer__fetch`→WebFetch.
- **`session/request_permission`** server-requests answered **in-process** against a per-agent policy `{fileWrite, bash, network, allowPaths[], denyPaths[]}`, choosing the ACP option whose `kind` is `allow_once`/`reject_once`.
- **Confirmed: goose path persists no tokens** — Octopal stores a `model_only` usage stub (zeros); only its *legacy claude-CLI* path parses real usage.
- Bundled as Tauri **sidecar (`externalBin`)**, downloaded at **build time** by `scripts/ensure-goose-sidecar.mjs`; runtime resolves the sidecar, never PATH (debug fallback behind an env flag).
- Provider CLIs (`claude`, `codex`) are **discovered, not bundled**. → **We avoid them entirely** by using only direct-API providers.

---

## 2. Scope decisions (locked, with rationale)

| Decision | Choice | Why |
|---|---|---|
| Integration mode | **`goose acp` long-lived sidecar over stdio** (Octopal-proven) | streaming tool events for the Agents dashboard, session reuse, in-process permission gate. (`goose run` one-shot is the fallback if ACP proves flaky.) |
| Provider scope v1 | **direct-API only**: OpenRouter, Gemini, Groq, Ollama | no need to bundle/discover claude-acp/codex CLIs; free is the whole point |
| Permission enforcement | `GOOSE_MODE=approve` + a `session/request_permission` handler that mirrors Forge's `READ_ONLY_TOOLS`/`WRITE_TOOLS` gate | faithful port of `subtaskRunner.canUseTool`; read-only denies shell/text_editor, builder allows |
| Cost | goose returns none → **record `costUsd: 0` for free providers**; estimate (token-count × price) only for paid-via-goose | honest: free really is $0. Flag in eval. |
| cwd / isolation | spawn `{ cwd: ensureWorkspace(convId) }`; XDG → `<userData>/goose/{config,data,state}` | reuses existing isolated-workspace model; never touches user's goose |
| Binary | build-time download script + electron-builder `extraResources`; resolve `process.resourcesPath`; dev PATH fallback | identical to how Forge already ships `claude.exe` (`asar:false`) |
| Secrets | `forge-providers.json` (Forge-private, outside `.claude/`) | same rule as `forge-mcp.json` |
| Dispatcher/HANDOFF | **NOT ported** | Forge already has its own orchestration core (conductor/routing/keywords); we only port the goose **ACP client** + **tool mapper** |

---

## 3. Architecture

```
                       Forge orchestration core (pure, unchanged)
                       conductor.executePlan → deps.runSubtask(subtask, attempt, …)
                                                     │
                                routing.route() decides ENGINE + provider/model
                                  ┌──────────────────┴───────────────────┐
                            engine='claude'                        engine='goose'
                                  │                                      │
                       agent/subtaskRunner.ts                   goose/runGooseSubtask.ts
                       (SDK query(), existing)                          │
                                                          goose/pool.ts (long-lived `goose acp`)
                                                                        │
                                                          goose/acpClient.ts  (JSON-RPC 2.0 / stdio)
                                                            initialize→session/new→prompt
                                                                        │
                                              goose/mapper.ts: session/update → AgentEvent
                                                  + session/request_permission → Forge gate
                                                                        │
                                          ┌─────────────────────────────┴─────────┐
                                   activity store (tool timeline)            Artifact{output,costUsd=0}
                                                                                   │
                                                                          conductor verify (toolVerifier/judge)
                                                                          FAIL → escalate ladder: goose-free → haiku → sonnet → opus
```

The conductor/topology/verifier code **does not change** — it already injects `deps.runSubtask`. We add a second adapter and a dispatcher in front of it.

---

## 4. File-by-file plan

### New: `src/main/providers.ts` (+ `forge-providers.json`)
Mirror `mcp.ts` exactly (list/save/delete, `readForgeConfig`/`writeForgeConfig`, name regex, secret-bearing).
```ts
export interface ProviderEntry {
  id: string                 // 'openrouter-free' | 'gemini' | 'groq' | 'ollama'
  gooseProvider: string      // GOOSE_PROVIDER value: 'openrouter' | 'google' | 'groq' | 'ollama'
  defaultModel: string       // GOOSE_MODEL value: e.g. 'qwen/qwen3-coder:free'
  apiKeyEnv?: string         // 'OPENROUTER_API_KEY' | 'GOOGLE_API_KEY' | 'GROQ_API_KEY' (none for ollama)
  apiKey?: string            // secret (stays in forge-providers.json)
  ollamaHost?: string        // 'http://localhost:11434'
  free: boolean              // routing hint: prefer for trivial/easy
  enabled: boolean
}
// + toGooseEnv(entry): Record<string,string>   // GOOSE_PROVIDER/MODEL + key env
```

### New: `src/main/goose/binary.ts`
Resolve the bundled goose binary: `process.resourcesPath/goose/<platform>-<arch>/goose[.exe]`; dev fallback to `goose` on PATH behind `FORGE_GOOSE_DEV=1`. Throw a clear "goose binary not found — run scripts/ensure-goose.mjs" error.

### New: `src/main/goose/env.ts`
`buildGooseEnv(entry, mode)`: start from a **minimal** map (not full `process.env` — mirror Octopal's `env_clear`), inject `GOOSE_PROVIDER`/`GOOSE_MODEL`/`GOOSE_MODE`, the provider key env, `OLLAMA_HOST` if ollama, and the three `XDG_*` dirs under `<userData>/goose/`. Keep `PATH` (needed to find node/ripgrep for goose's Developer extension).

### New: `src/main/goose/acpClient.ts`  ← **the load-bearing port of Octopal's `AcpClient`**
A TS class over `child_process.spawn(gooseBin, ['acp'], { cwd, env, stdio: ['pipe','pipe','pipe'] })`.
- newline-delimited JSON-RPC: `request(method, params, timeoutMs)` → Promise, with a `Map<id, {resolve,reject}>`.
- stdout reader line-buffers and classifies: **response** (`id`, no `method`), **server-request** (`method==='session/request_permission'` → call the injected permission handler, reply), **notification** (`method==='session/update'` → emit to the mapper).
- methods: `initialize()`, `sessionNew(cwd)`, `sessionSetMode(sessionId, modeId)`, `sessionPrompt(sessionId, text)`.
- `shutdown()` = SIGTERM then SIGKILL (no `session/cancel`). Prompt timeout 300s (configurable).

### New: `src/main/goose/mapper.ts`
Port of `goose_acp_mapper.rs`: `session/update` → a Forge event shape. Tool normalization map (`developer__shell`→`Bash`, `developer__text_editor`→`Write`/`Edit` by `command`, `developer__read_file`→`Read`, `developer__fetch`→`WebFetch`, else `Passthrough`). Emit into the existing **agent-activity bus** (`pet/bus`) so the Agents dashboard tool timeline + subagent nesting work for goose subtasks too — **zero new UI**.

### New: `src/main/goose/pool.ts`
Process pool keyed by `${provider}::${model}::${mode}::${cwd}`. v1 may be trivial (one process per subtask, shut down after); v2 reuses long-lived processes with fresh `session/new` per call. Cap concurrent goose procs.

### New: `src/main/goose/runGooseSubtask.ts`  ← **adapter matching `runSubtaskQuery`**
```ts
export async function runGooseSubtask(opts: {
  instruction: string; context?: string; systemAppend?: string
  provider: ProviderEntry; writeCapable?: boolean; maxTurns?: number; cwd: string
  signal?: AbortSignal
}): Promise<{ output: string; costUsd: number; model: string }>
```
- mode = `writeCapable ? 'approve' : 'approve'` (always `approve` so the gate runs; pure-text roles could use `chat`).
- permission handler = port of `subtaskRunner` gate: builder allows shell/text_editor/read/fetch; read-only allows read/grep/glob/fetch, denies shell/text_editor. `Task`/recursive spawn always denied.
- system prompt prepended into the prompt text (ACP has no system field), reusing the existing subtask preamble + `roles.ts systemAppend`.
- accumulate `agent_message_chunk` text → `output`; `costUsd: 0` (free) ; `model` from provider.

### Changed: `src/main/routing.ts` (stays pure — no SDK/electron import)
Add an engine/provider axis to `RouteDecision`:
```ts
export type Engine = 'claude' | 'goose'
export interface RouteDecision { …; engine: Engine; provider?: string; model: string; … }
```
- New input: `freeProviderAvailable?: boolean`, `capability?: 'agentic'|'text'` (default agentic).
- Rule: if `difficulty ∈ {trivial,easy}` AND `freeProviderAvailable` AND not explicitly pinned to a Claude tier → `engine='goose'`. Else Claude tier as today.
- **Cascade ladder becomes engine-aware**: `goose-free → haiku → sonnet → opus`. `escalate()` from goose-free steps to `haiku` (engine flips to claude). priorFailures walks the ladder exactly as today → free tries first, verifier FAIL escalates to paid.
- Keep the heuristic a tunable default (same honesty caveat as today). **Add selftest cases** for the new branch.

### Changed: dispatcher in the conductor's `deps.runSubtask` (in the orchestrate IPC / runner that builds `deps`)
Consult `routing.route(...)`; if `engine==='goose'`, resolve the `ProviderEntry` (impure lookup, injected) and call `runGooseSubtask`; else `runSubtaskQuery`. Mirror to activity store with engine/provider provenance (extend the existing `🔧tool/⚖judge` provenance with a `🪿 goose:<provider>` tag).

### Changed: `src/main/ipc/` — re-wire orchestration to a chat entry point
This is what makes it *feel automatic*. Options (pick in Phase 3):
- a magic keyword (`cheap` / `delegate`) in `keywords.ts` that routes the run's simple subtasks through goose; and/or
- auto: when the model's plan has trivial/easy subtasks and a free provider is enabled, route them to goose by default.
Add `providers:*` IPC channels (list/save/delete/test) + an **Extend → Providers** panel (mirror `McpPanel`).

### New: `scripts/ensure-goose.mjs`  +  `electron-builder.yml`
Build-time: download the pinned goose release per platform, unpack the binary into `resources/goose/<platform>-<arch>/`, chmod +x on unix. Add to `extraResources` (alongside `resources/pet`). Pin version in `scripts/goose-version.json`. **TODO: confirm release host (block/goose vs aaif-goose) at build time.**

### New: `src/main/providers.ts` IPC + `src/renderer/.../extend/ProvidersPanel.tsx`
GUI to add a provider + key + default model + enable. Pure `window.forge.providers` calls (near-zero coupling, like other Extend panels).

### Docs
Update `README.md` (privacy section: "free providers send subtask content to that provider — opt-in") and `docs/TOKEN_OPTIMIZATION.md` (free-tier as a new cost lever) once shipped.

---

## 5. Phases + verification gates

Each phase is independently valuable and must pass its gate before the next.

**Phase 0 — provider plumbing** (`providers.ts` + `forge-providers.json` + IPC + ProvidersPanel).
Gate: `npm run typecheck`, `npm run lint`; manually add an OpenRouter key in the UI and confirm it round-trips to `forge-providers.json`.

**Phase 1 — goose adapter + binary + ACP client** (`goose/*`, `runGooseSubtask`, `ensure-goose.mjs`).
Gate: a **spike script** `scripts/goose-spike.mjs` — download goose, spawn `goose acp`, run `initialize→session/new→session/prompt` with an OpenRouter `:free` model against a temp cwd, and assert: (a) text output returned, (b) a builder run actually edits a file, (c) a read-only run is **denied** shell/edit by our permission handler. This is the make-or-break verification (proves ACP works on Forge's box and the gate holds). Capture stdout to confirm the `session/update` schema for the mapper.

**Phase 2 — routing engine axis + dispatcher + activity mapping**.
Gate: `npm run selftest` extended with engine/provider routing cases (pure, no live goose): trivial+free→goose, hard→opus, free FAIL→escalate to haiku→…→opus. Confirm goose tool events appear in the Agents dashboard timeline.

**Phase 3 — wire to chat + free→Claude verifier cascade + eval honesty**.
Gate: `EVAL_LIVE=1` golden-set run showing orchestrated-with-free ≥ single-Claude-baseline quality at lower $ (the §8 kill-criteria gate must stay honest — add a **quality-regression guard** so free routing can't silently drop golden-set scores). Manual: a `cheap` keyword run completes simple subtasks at $0 and escalates a deliberately-hard one to Claude.

**Phase 4 (optional)** — pooled long-lived sessions, `goose serve` HTTP transport, paid-via-goose cost estimation, CLI-subscription providers (claude-acp/codex), more models.

---

## 6. Risks & open questions (must resolve before depending on them)

1. **Cost blindness** — goose ACP returns no usage. Mitigation: $0 for free providers (true); token-estimate for paid. The budget governor still bounds Claude-tier spend, which is where real $ is.
2. **Release host discrepancy** — `block/goose` vs `aaif-goose/goose`. Pin + checksum-verify at build; re-confirm at integration.
3. **ACP JSON schema drift** — `session/update` / `session/request_permission` shapes vary across goose versions. Mitigation: pin goose version; mapper tolerant of snake_case+camelCase (as Octopal does); capture real output in the Phase 1 spike.
4. **Small-model tool-use reliability** — free models loop/emit bad tool args. Mitigation: this is exactly what the **verifier→escalate-to-Claude cascade** absorbs; cap `maxTurns` + max-tool-repetitions.
5. **Windows / locked-down env** — goose Windows asset is x86_64-msvc `.zip`; spawning `goose.exe` should behave like `claude.exe` (asar:false already). Confirm XDG env vars are honored on Windows (Octopal sets them unconditionally and it works).
6. **goose v2.0-rc stability + no `session/cancel`** — cancellation is SIGKILL; ensure STOP from the UI kills the goose proc and frees the pool slot.
7. **Privacy** — content leaves the machine to the provider. User has approved dropping local-only; still surface a clear per-provider notice and update README.

---

## 7. What we deliberately do NOT do
- Don't port Octopal's dispatcher / HANDOFF / room-history — Forge's conductor + routing + keywords already own orchestration.
- Don't bundle claude-acp/codex CLIs — direct-API free providers only (v1).
- Don't redirect the SDK's **native Task subagents** to goose (impossible — they run inside `claude.exe`); goose lives only behind Forge's own orchestration path.
- Don't pursue Zed Agent Client Protocol *as a client integration of the SDK* (wrong direction, established earlier) — here ACP is used the other way: **Forge is the ACP client driving goose as the ACP agent.**
