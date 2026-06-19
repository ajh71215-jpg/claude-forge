# Efficiency subsystems — absorbed open-source value

Four open-source projects were distilled (re-implemented from scratch, never
vendored) into a coherent **token-efficiency + context-awareness** layer. The
theme: spend fewer tokens to reach the same answer, and stop re-deriving context
the agent already has. Each subsystem has a **pure core** covered by
`npm run test` (node:test), so the logic is provable without a subscription.

| Source (license) | Forge subsystem | Where |
|---|---|---|
| [chopratejas/headroom](https://github.com/chopratejas/headroom) (Apache-2.0) | Context compression | `src/main/efficiency/compress.ts` |
| [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) (Apache-2.0) | Persistent project memory | `src/main/memory/` |
| [Egonex-AI/Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) (MIT) | Structural repo map | `src/main/repomap/` |
| [mattpocock/skills](https://github.com/mattpocock/skills) (MIT) | Curated starter skill pack | `src/main/skillsPack.ts` |

## 1. Context compression (headroom)

"Same answers, a fraction of the tokens." Forge wraps the Agent SDK, so it can't
rewrite the SDK's own tool results mid-loop — but it **can** compress the context
it constructs itself. `compress.ts` is a pure compressor: JSON clip+minify, line
dedup, blank-line collapse, and budget-bounded **head/tail elision with visible
markers** (every drop says how much it dropped — headroom's "reversible"
principle minus the retrieval round-trip the SDK loop can't host). Used by the
memory and repo-map injectors below to fit their budgets.

## 2. Persistent project memory (agentmemory)

agentmemory's loop: capture observations from tool use → privacy-filter → recall
the relevant slice at session start within a token budget (it reports ~92% token
reduction vs pasting full context). Forge's version:

- **Capture** (`memory/capture.ts`) taps the existing agent event bus in the main
  process — the same bus the pet and activity store use — and turns *durable*
  actions (file edits → `semantic`, shell commands → `procedural`) into entries.
  Reads/greps are dropped as noise. Zero extra tokens; secrets are stripped
  before storage (`observe.ts` privacy filter).
- **Recall** (`retrieve.ts`, pure) ranks by **BM25 × recency-decay × usage-boost**
  (`bm25.ts`, pure), enforces per-session diversity, and selects within a token
  budget. Offline-first: no embedding model, no network — an honest subset of
  agentmemory's BM25+vector+graph RRF fusion (vector recall is a later step).
- **Inject**: on a *fresh* conversation only (so the prompt cache isn't churned
  mid-conversation), the recalled slice is compressed and prepended in a
  caveated `<project-memory>` block.
- **UI**: EXTEND → Memory (browse/search/prune + toggle). Stored in
  Forge-private `forge-memory.json` (out of `.claude/`), default on, no-op until
  facts accrue.

## 3. Structural repo map (Understand-Anything)

Understand-Anything pairs Tree-sitter (static) with an LLM (semantic) to make a
codebase navigable. Forge ships the **static layer only**, dependency-free: a
regex parser (`parse.ts`) extracts per-file exports/imports/symbols
(TS/JS/TSX/PY/Go/Rust), a PageRank-lite ranker (`build.ts`) orders files
most-imported-first, and a compact renderer produces a budget-bounded map.
Injected (compressed) into a fresh conversation so the agent navigates by map
instead of burning tokens on exploratory globs/reads — **retrieval-first**. A
fingerprint cache (`scan.ts`) rebuilds only when files change. Surfaced as a
**Repo map** tab in the Workspace viewer. Honest caveat: regex, not a full
grammar — exotic syntax may be missed.

## 4. Curated starter skill pack (mattpocock/skills)

mattpocock/skills are small, composable, model-agnostic engineering skills that
target AI-coding failure modes. Re-authored (MIT, attributed) into a bundled
registry (`skillsPack.ts`), one-click installable from EXTEND → Skills into a
standard `.claude/skills/<name>/SKILL.md`: **caveman** (token-efficient comms,
~75% fewer output tokens), **grill** (align before building — cuts wasted turns),
**tdd**, **diagnose**, **handoff**. Install is idempotent and never clobbers a
user edit.

## How they chain

On a fresh conversation, runStreaming prepends **repo map** (stable structure) +
**recalled memory** (query-relevant facts), each compressed and budget-bounded.
The agent starts oriented and informed; `caveman` then trims output tokens on the
way back. Net effect: fewer exploratory reads, less re-explanation, terser
output — the same task at a fraction of the tokens.

## Verification status (honest)

- **Verified headlessly**: all pure cores — compression, BM25, retrieval,
  observation/privacy, repo-map parse/rank/render — via `npm run test`
  (54 assertions); full `typecheck`, `build`, and `selftest` (105) green.
- **Pending a live subscription session** (this cloud env has no key / no GUI):
  the actual recall quality, injection effect on real runs, and the renderer
  panels were not exercised against a live model. Wiring is type-safe and builds;
  behavior needs a local Electron run to confirm.

## Forge-owned tool-result cap — `capToolResult` (2026-06-19)

The compression core gained `capToolResult(text, maxTokens=8000, label)` +
`FORGE_CONTEXT_TOKEN_CAP` (single tunable source of truth). It is the one place
Forge can enforce the report's "bound large observations / keep tool responses
under 25k tokens" rule, since the SDK's own tool results are out of reach — only
**Forge-constructed** context flows through it:

- **Live**: the goose `delegate` result (`goose/delegateTool.ts`) — previously an
  unbounded free-model dump re-sent every turn (O(n²)); now capped marked-lossy.
- **Latent**: the orchestration blackboard context (`agent/subtaskRunner.ts`) —
  the conductor engine is a selftest-only library with no runtime caller, so this
  is a zero-cost consistency fix for when/if it is wired up.
- **Metric**: per-run `injectedTokens` (repo-map + memory) now persists to
  `AgentActivity` (data layer; Cost-tab surfacing is a deferred renderer task).

Pure + tested (`npm run test`, 58 assertions). See `docs/TOKEN_OPTIMIZATION.md`
§10 for the full SDK-controlled-vs-Forge-controlled lever taxonomy and honest
limits (MCP tool-definition occupancy is not measurable from Forge).

## Four more levers — as much as the architecture honestly allows (2026-06-19)

The report's remaining four (observation masking, semantic response caching,
prompt compression, RAG) — each with a pure tested core; wired only where the
local-only / CLI-wrapper architecture permits (full detail + honest limits in
`docs/TOKEN_OPTIMIZATION.md` §11):

- **RAG / Contextual Retrieval** (`src/main/retrieval/`) — chunk workspace
  content, BM25-rank top-k for the query (reuses `memory/bm25`), inject fresh-turn
  only with `path:line` provenance (model-free Contextual Retrieval). Naturally
  gated: no term overlap ⇒ nothing injected. **Live.**
- **Response cache** (`efficiency/responseCache.ts`) — pure LRU+TTL; normalized-
  exact by default (no embedder ⇒ not true semantic). Wired to **read-only goose
  delegations only** (write tasks never cached). **Live, scoped.**
- **Prose squeeze** (`efficiency/compress.ts` `squeezeProse`) — model-free filler-
  phrase removal (not stopword removal; not true LLMLingua). Applied to memory
  prose only, never code. **Live, conservative.**
- **Observation masking** (`efficiency/mask.ts`) — faithful pure core, but the
  live CLI loop owns its history so it can't be masked (same limit as
  `clear_tool_uses`); ships as a **tested core, not live-wired.**

All pure cores covered by `npm run test` (75 total); typecheck + build green.

## codegraph + claude-mem absorption (call-graph MCP + progressive disclosure)

Two more open-source ideas distilled, each chosen to fill a *specific* gap in the
existing efficiency layer rather than duplicate it. Both keep the local-only /
BYO-key constraint intact.

### 1. CodeGraph as a recommended MCP server (`src/main/mcpPack.ts`)

Forge's own repo map (`repomap/`) is structure-only: a regex symbol map, rebuilt
not synced, with no call edges. **CodeGraph** (github.com/colbymchenry/codegraph,
MIT) is a standalone, 100%-local MCP server that adds exactly what's missing —
call-graph navigation (`who calls this?` / caller-callee trails), OS file-watch
incremental sync, and on-demand symbol queries against a local SQLite graph (no
API keys, no egress). Because it's a *server*, the honest integration is to
**register, not port**: `mcpPack.ts` is a curated "Recommended" pack (mirroring
`skillsPack.ts`) that one-click writes CodeGraph's config
(`codegraph serve --mcp`, stdio) into the Forge-private `forge-mcp.json` via the
existing `saveMcpServer` path — idempotent, never clobbering a user edit. EXTEND →
MCP shows a card with the author-reported metric (median across 7 repos: 16%
cheaper · 58% fewer tool calls · 47% fewer tokens) and the one-time binary
prerequisite (`npm i -g @colbymchenry/codegraph` + `codegraph init` per project).
Querying a graph on demand beats injecting a static map up front. **Wiring +
typecheck/build green; the live MCP handshake needs the user to install the
binary (not bundled like goose — registration only).**

### 2. Progressive disclosure for memory (`src/main/memory/disclose.ts` + `memoryServer.ts`)

The portable win from **claude-mem** (thedotmack/claude-mem, MIT) is *not* its
heavy stack (SQLite + Chroma + a port-37777 worker + hooks — all of which overlap
Forge's existing `memory/`), but its retrieval shape: a three-stage,
graduated-detail flow that **filters before fetching detail** (claude-mem reports
~10× savings). Ported as a pure core over Forge's own `MemoryEntry[]`:

- `searchIndex` — a compact INDEX (id + kind + ~90-char snippet), BM25-ranked via
  the existing `memory/bm25`. Cheap to scan many.
- `timeline` — the chronological NEIGHBORS of chosen ids (deltaMs from the
  anchor) — context to judge relevance before paying for detail.
- `getRecords` — the FULL text, for a filtered id set only (the one expensive call).

`memoryServer.ts` is the thin SDK glue exposing these as `memory_search` /
`memory_timeline` / `memory_get` MCP tools (reusing the in-process-server pattern
from goose's `delegateTool`). Registered in `runStreaming` **only when the user
opts in** (`memory.toolsEnabled`, default off, EXTEND → Memory) so the
token-frugal default never pays the live-tool tax; gated on the stable enabled
flag so the tool prefix stays cache-stable across a conversation. Complements (not
replaces) the cheap fresh-turn upfront recall — the tools let the model go *deeper*
on demand instead of dumping everything. **Pure core covered by `npm run test`
(now 85 total); the live tool round-trip + 10× claim are unverified in the cloud
session (no key/GUI) — confirm on a local Electron run.**

> Deferred: **graphify** (interactive HTML graph + god-node report) overlaps repo
> map most and its non-code path costs LLM tokens (local-only exception). For the
> coding loop, CodeGraph is the strict upgrade; a future "Repo Graph" Workspace tab
> could surface graphify's visualization, but it's lower priority and unbuilt.
