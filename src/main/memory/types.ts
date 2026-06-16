// Persistent project-memory types — the portable idea absorbed from
// rohitg00/agentmemory (Apache-2.0): capture observations from tool use, keep
// them across sessions, and inject only the relevant slice (within a token
// budget) at the start of a new conversation, so the agent doesn't re-derive
// what it already learned. agentmemory reports ~92% token reduction vs pasting
// full context; the win here is the same — recall instead of re-explain.
//
// Forge stays local-only: memory is a Forge-private JSON file (no external DB,
// no embedding service). Retrieval is lexical BM25 + recency/usage decay, which
// needs no model and no network — an honest, offline-first subset of
// agentmemory's BM25+vector+graph RRF fusion. (Vector recall is a documented
// later step; see docs.)

/** agentmemory's 4-tier consolidation model (working→episodic→semantic→procedural). */
export type MemoryKind = 'working' | 'episodic' | 'semantic' | 'procedural'

export interface MemoryEntry {
  id: string
  kind: MemoryKind
  /** The fact/observation, already privacy-filtered. */
  text: string
  /** Lightweight retrieval tags (file extensions, 'edit', 'bash', …). */
  tags: string[]
  /** Provenance: 'tool:Edit', 'tool:Bash', 'session', 'manual', … */
  source: string
  sessionId?: string
  workspaceId?: string
  /** Dedupe key (hash of the normalized text); identical observations collapse. */
  hash: string
  createdAt: number
  lastAccess: number
  accessCount: number
}

/** A raw observation pulled off the agent event bus, before it becomes an entry. */
export interface Observation {
  tool: string
  input: Record<string, unknown>
  ok: boolean
  sessionId?: string
  workspaceId?: string
}

export interface RetrieveOptions {
  /** Max injected tokens (agentmemory default ≈2000). */
  budgetTokens?: number
  /** Cap results per originating session, for diversity (agentmemory uses 3). */
  maxPerSession?: number
  /** Half-life (ms) for recency decay. Default 14 days. */
  halfLifeMs?: number
  /** Restrict to a workspace; undefined = all. */
  workspaceId?: string
  /** Clock injection for deterministic tests. */
  now?: number
}
