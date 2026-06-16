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
