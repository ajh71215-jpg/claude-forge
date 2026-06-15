# GOOSE_INTEGRATION.md — free/multi-provider sub-agents via goose

Status: **Phases 0–2 IMPLEMENTED & verified (typecheck + selftest + live ACP spike); live model call pending a provider key (user testing tomorrow).**

Landed: `src/main/providers.ts` (+ `forge-providers.json`), `src/main/goose/{binary,env,acpClient,mapper,runGooseSubtask,delegateTool}.ts`, delegate-server wiring in `agent/runStreaming.ts` (threads runId), `providers:*` IPC + preload + `extend/ProvidersPanel.tsx`, `routing.pickProvider` (+5 selftest checks → 98), **Phase 2**: `agentActivity.gooseSubtask{Start,Tool,Finish}` so a delegated subtask nests as a card under the main run with a tool timeline (goose `session/update` → mapper → activity store, zero new UI), `scripts/{ensure-goose,goose-spike}.mjs` + `goose-version.json`, electron-builder `extraResources`. Verified live (goose 1.37.0): full `initialize→session/new→set_mode→session/prompt` lifecycle; env-based key injection (`OPENROUTER_API_KEY`); the `usage_update` token stream; `ensure-goose.mjs` download+extract+run. Pending (needs a key): actual model call + tool use + the `session/request_permission` payload shape (the read-only gate falls closed until confirmed). Run `scripts/goose-spike.mjs` with a key to close these.

**Hardening (key-free, landed):**
- **Interrupt cleanup** — `goose/registry.ts` tracks active goose clients per runId; `interruptRun` calls `killGooseForRun(runId)` so STOP kills in-flight delegated processes (no ACP cancel exists; they'd otherwise run to goose's 300s timeout).
- **Concurrency cap** — a semaphore (`FORGE_GOOSE_MAX_CONCURRENT`, default 3) bounds simultaneous goose processes when Claude fires several `delegate(...)` calls in parallel.
- **Runaway guard** — `GOOSE_MAX_TURNS` (default 30, `FORGE_GOOSE_MAX_TURNS` override) caps a confused free model's loop (goose's own default is 1000); per-request 300s wall-clock cap already exists.
- **`cheap` magic keyword** — typing `cheap`/`delegate`/`budget mode` (EN/KO/JA) activates a delegate-nudge mode (chip + user-prefix directive) so the chat UX "feels automatic" (+3 selftest checks → 101). Same false-positive guards as other keywords.

**Phase 3 note:** the `delegate` tool's *description* (and now the `cheap` keyword) tell Claude when to offload, so no always-on system-prompt injection was added (keeps the prompt cache byte-stable + avoids persona conflicts). An eval quality-regression guard remains the main Phase 3 follow-up.

**Still genuinely remaining (mostly needs a key or live run):**
- confirm `session/request_permission` shape → finalize the read-only gate (currently fail-closed);
- confirm `agent_message_chunk`/`tool_call` field names in the mapper;
- eval quality-regression guard (`eval.ts`) — delegation must not lower golden-set scores;
- optional Phase 4: provider quota/429 fallback to the next provider, paid-via-goose cost pricing from `tokensUsed`, long-lived pooled sessions / `goose serve`, a "Test provider" button, bounded multi-provider debate. Goal: let Forge's orchestration delegate simple/cheap subtasks to **free or cheaper non-Anthropic models** (OpenRouter `:free`, Google Gemini free tier, Groq, local Ollama) as *full agentic* sub-agents (file edit / grep / shell), so the easy work costs $0 and only failures escalate to paid Claude.

**Chosen architecture: Plan A — Claude-as-orchestrator (hub-and-spoke).** The main chat Claude *is* the orchestrator. Forge exposes a custom **`delegate` tool** (in-process MCP) to the main run; Claude decides what to offload, writes the sub-task scope+prompt itself, and calls `delegate(...)`. Forge intercepts the call, runs it on a free model via goose, and returns the result text inline to Claude. Sub-agents never talk to each other directly — they **exchange *through* Claude** (Claude reads result A, frames prompt B with it), which keeps cost, loops, and verification under control. (The alternative deterministic-conductor design — "Plan B" — is recorded in §8; we are NOT building it. Free-form agent-to-agent chat — Octopal's HANDOFF — is deliberately excluded, see §7.)

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
| Entry point | **in-process MCP `delegate` tool** exposed to the main chat run (Plan A) | Claude calls it like `Task`, but Forge routes it to goose; no conductor wiring needed |
| Agent-to-agent chat / HANDOFF | **NOT ported** | loops/cost/verification-gap; hub-and-spoke through Claude gives the collaboration benefit safely (§7) |
| Deterministic conductor (Plan B) | **NOT built** (kept as library) | user chose Claude-as-orchestrator; conductor path recorded in §8 only |

---

## 3. Architecture (Plan A — hub-and-spoke through Claude)

```
        Main chat run = THE ORCHESTRATOR (Claude, via SDK runStreaming)
        │   Forge gives it an in-process MCP server exposing one tool:
        │     delegate({ instruction, tier?, role?, writeCapable?, verifyCommands? }) → { output }
        │
        │  Claude decides "this is simple → offload", writes the sub-prompt, calls delegate(...)
        ▼
   ipc/agent.ts wires mcpServers += forgeDelegateServer   (alongside existing forge-mcp.json servers)
        │
        ▼
   goose/delegateTool.ts  (MCP tool handler)
        │  picks a ProviderEntry (routing.route → free model for trivial/easy; else cheapest enabled)
        ▼
   goose/runGooseSubtask.ts ── goose/pool.ts (long-lived `goose acp`) ── goose/acpClient.ts (JSON-RPC/stdio)
        │                          initialize → session/new(cwd) → set_mode → session/prompt
        │
        ├─ goose/mapper.ts: session/update → activity bus  (Agents dashboard timeline, nested under the run)
        ├─ session/request_permission → Forge read-only/builder gate
        │
        ▼
   result text returned to the delegate tool  → returned inline to Claude as the tool_result
        │  (cost: $0 for free providers)  │  Claude reads it, may delegate again or finish.
        ▼
   (optional) auto-escalation: if a delegated result fails Claude's own check, Claude simply
   re-does it itself or delegates at a higher tier — escalation is Claude's judgement, not a fixed ladder.
```

**What changes in Forge:** we add the `goose/*` modules + `providers.ts`, and register one extra in-process MCP server on the main run (`ipc/agent.ts`). `runStreaming` and the SDK loop are otherwise untouched; the SDK already merges `mcpServers`, surfaces the tool to the model, and routes its use through `canUseTool` + the activity bus — so the delegate tool's calls show up in chat and the Agents dashboard for free. The conductor/topology/verifier code is **not touched** (it stays a library).

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
- `GOOSE_MODE=approve` always (so our `session/request_permission` gate actually runs); a pure-text/read-only role may use `chat` (no tool execution at all).
- permission handler = port of `subtaskRunner` gate: builder allows shell/text_editor/read/fetch; read-only allows read/grep/glob/fetch, denies shell/text_editor. `Task`/recursive spawn always denied.
- system prompt prepended into the prompt text (ACP has no system field), reusing the existing subtask preamble + `roles.ts systemAppend`.
- accumulate `agent_message_chunk` text → `output`; `costUsd: 0` (free) ; `model` from provider.

### New: `src/main/goose/delegateTool.ts`  ← **the Plan A entry point (in-process MCP server)**
An MCP server (SDK `createSdkMcpServer` / tool) exposing **one tool** to the main chat Claude:
```ts
// tool name: "delegate" (namespaced e.g. mcp__forge__delegate)
delegate({
  instruction: string,          // the sub-prompt Claude writes
  tier?: 'free'|'cheap'|'auto',  // hint; 'free' forces a free provider, default 'auto'
  role?: string,                // optional roles.ts persona (systemAppend + writeCapable default)
  writeCapable?: boolean,       // may the sub-agent edit files? default from role, else false
  verifyCommands?: string[]     // optional objective check (typecheck/test) the sub-agent must pass
}) → { output: string, model: string, costUsd: number }
```
Handler: resolve a `ProviderEntry` (via `pickProvider` below) → `runGooseSubtask(...)` with the conversation's `cwd` → return the result text. Errors (no provider enabled / goose missing / quota 429) return a clear tool-error so **Claude can fall back to doing it itself** — graceful degradation, never a hard run failure.

The tool description (shown to Claude) tells it *when* to use it: "Delegate a self-contained, low-stakes subtask (summarize, draft, classify, simple edit, lookup) to a free model to save budget. Provide a complete, standalone instruction — the sub-agent has no chat history. Verify the result yourself before relying on it."

### Changed: `src/main/ipc/agent.ts` — register the delegate MCP server on the main run
Where `runStreaming` opts are built, merge the delegate server into `mcpServers` (next to `forge-mcp.json` servers) **only when ≥1 provider is enabled**. Gate behind a setting (LIMITS/Settings: "Allow delegating subtasks to free providers"). Nothing else in `runStreaming` changes — the SDK surfaces the tool, routes its use through `canUseTool`, and streams `block-start`/`tool-result` (with `parent_tool_use_id`) so the delegate call already nests in chat + the Agents dashboard.

### Changed: `src/main/routing.ts` (stays pure) — provider picker only
No "engine axis" needed in Plan A (the tool *is* the goose path). Add a small pure helper used by the delegate handler:
```ts
export function pickProvider(
  tierHint: 'free'|'cheap'|'auto', instruction: string,
  enabled: { id: string; free: boolean }[]
): string | undefined   // returns provider id, or undefined → caller tells Claude "no free provider; do it yourself"
```
Reuse `classifyDifficulty` as a tunable hint (e.g. `auto` + `hard` → return undefined so Claude keeps hard work itself). Keep the heuristic a default, not an oracle. **Add selftest cases** for `pickProvider`.

### New: `src/main/ipc/providers.ts` + `src/renderer/.../extend/ProvidersPanel.tsx`
`providers:*` IPC (list/save/delete/test) + an **Extend → Providers** panel (mirror `McpPanel`): add a provider, key, default model, enable. Pure `window.forge.providers` calls.

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

**Phase 2 — delegate tool + MCP registration + activity mapping** (`delegateTool.ts`, `pickProvider`, `ipc/agent.ts` wiring).
Gate: `npm run selftest` extended with `pickProvider` cases (pure, no live goose): `free`→provider, `auto`+`hard`→undefined (Claude keeps it), no-enabled→undefined. Manual (Electron): a chat run where Claude calls `delegate(...)`, the call nests in chat + the Agents dashboard timeline, and the result returns inline.

**Phase 3 — chat UX + guidance + eval honesty**.
The main system prompt gets a short note that the `delegate` tool exists and when to prefer it (Forge-side append, cache-stable). Optional: a `cheap` magic keyword that nudges Claude to offload aggressively for that run; a Settings toggle + a per-run "delegated $0 / saved est." indicator.
Gate: `EVAL_LIVE=1` golden-set run showing **delegation does not drop quality** vs Claude-only at equal-or-lower $ — add a **quality-regression guard** (free delegation can't silently lower golden-set scores). Manual: simple subtasks run at $0 via goose; a hard task Claude (correctly) keeps itself.

**Phase 4 (optional)** — pooled long-lived sessions, `goose serve` HTTP transport, paid-via-goose cost estimation, bounded multi-provider **debate** topology (structured, not free chat), CLI-subscription providers (claude-acp/codex).

---

## 6. Risks & open questions (must resolve before depending on them)

1. **Cost blindness** — ⬆️ **partially resolved**: goose ACP returns no usage in the `session/prompt` *response*, but it DOES stream a `usage_update` notification (`{sessionUpdate:"usage_update", used, size}` — verified live). `runGooseSubtask` captures `used` (tokens) → `GooseSubtaskResult.tokensUsed`. costUsd stays $0 for free providers (true); paid-via-goose can price `tokensUsed`. Real $ stays on the Claude main run, bounded by the existing LIMITS max-$/run cap.
2. **Release host discrepancy** — `block/goose` vs `aaif-goose/goose`. Pin + checksum-verify at build; re-confirm at integration.
3. **ACP JSON schema drift** — ✅ **VERIFIED LIVE** against goose **1.37.0** (`stable`, linux-gnu) on 2026-06-15 (key-free; only `session/prompt` needs a provider). Confirmed envelopes:
   - `initialize` req `{protocolVersion:1, clientCapabilities:{}}` → `{result:{protocolVersion:1, agentCapabilities:{loadSession, promptCapabilities:{image,embeddedContext}, mcpCapabilities:{http:true}, sessionCapabilities:{list,close}}, authMethods:[{id:"goose-provider"}]}}`
   - `session/new` req `{cwd, mcpServers:[]}` → `{result:{sessionId, modes:{currentModeId:"auto", availableModes:[auto, approve, smart_approve, chat]}}}` (the 4 modes confirmed live)
   - **notification** = `{method:"session/update", params:{sessionId, update:{ sessionUpdate:"<variant>", … }}}` — **the discriminator is `params.update.sessionUpdate` (camelCase)**; variants per Octopal: `agent_message_chunk`/`agent_thought_chunk`/`tool_call`/`tool_call_update`/`available_commands_update`. The mapper keys off `params.update.sessionUpdate`.
   Both release hosts (`block/goose`, `aaif-goose/goose`) serve `stable` (HTTP 200); we pin a version + checksum at build. Remaining unverified (needs a key): exact `agent_message_chunk`/`tool_call` payload fields + `session/request_permission` shape — capture in the keyed spike.
4. **Small-model tool-use reliability** — free models loop/emit bad tool args. Mitigation: in Plan A **Claude is the safety net** — it reads every delegated result and re-does or re-delegates anything wrong; cap `maxTurns` + max-tool-repetitions; optional `verifyCommands` gives the sub-agent an objective check before returning.
5. **Windows / locked-down env** — goose Windows asset is x86_64-msvc `.zip`; spawning `goose.exe` should behave like `claude.exe` (asar:false already). Confirm XDG env vars are honored on Windows (Octopal sets them unconditionally and it works).
6. **goose v2.0-rc stability + no `session/cancel`** — cancellation is SIGKILL; ensure STOP from the UI kills the goose proc and frees the pool slot.
7. **Privacy** — content leaves the machine to the provider. User has approved dropping local-only; still surface a clear per-provider notice and update README.

---

## 7. What we deliberately do NOT do
- **No free-form agent-to-agent chat / HANDOFF** (Octopal's mesh model). Reasons: token blowup, A↔B loops (Octopal needs depth caps + locks + already-called sets), no verification gate so errors compound, and it breaks budget discipline. The collaboration benefit is preserved by **hub-and-spoke through Claude** — sub-agents exchange info *via* the orchestrator, which reads result A and frames prompt B. If structured disagreement is ever wanted for quality, use a **bounded debate topology** (rounds + early-stop), not open chat.
- Don't bundle claude-acp/codex CLIs — direct-API free providers only (v1).
- Don't redirect the SDK's **native Task subagents** to goose (impossible — they run inside `claude.exe`). Delegation reaches goose only via the **`delegate` MCP tool** Forge exposes to the main run.
- Don't build the deterministic conductor path (Plan B, §8) — kept as a library only.
- Don't pursue Zed Agent Client Protocol *as a client integration of the SDK* (wrong direction) — here ACP is used the other way: **Forge is the ACP client driving goose as the ACP agent.**

---

## 8. Rejected alternative — Plan B (deterministic conductor)
Recorded for completeness. Forge's pure orchestration core (`conductor`/`topology`/`routing`/`verifier`) builds a validated plan DAG, routes trivial/easy subtasks to goose via `deps.runSubtask`, gates each with the tool-oracle/judge verifier, and walks a fixed cascade ladder `goose-free → haiku → sonnet → opus`, escalating only on a verifier FAIL. Pros: provable, budget-capped, honest same-compute eval. Cons: Claude does not "freely decide" delegation — Forge owns the skeleton. **User chose Plan A** (Claude-as-orchestrator) for flexibility; the conductor stays a tested library (`npm run selftest`) and could back a future "auto-plan" mode without conflicting with the delegate tool.
