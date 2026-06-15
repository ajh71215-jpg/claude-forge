// Pure memory retrieval: rank stored entries for a query and select a
// budget-bounded, diverse slice to inject — agentmemory's SessionStart recall
// (BM25 + recency/usage decay + session diversity + token budget). The combined
// score mirrors agentmemory's intent: lexical relevance, boosted by how recent
// and how frequently-used a memory is (Ebbinghaus-style decay; frequently
// accessed items strengthen). NO electron/SDK imports → unit-tested headlessly.

import { estimateTokens } from '../efficiency/compress'
import { rankBm25 } from './bm25'
import type { MemoryEntry, RetrieveOptions } from './types'

const DAY = 86_400_000

interface Scored {
  entry: MemoryEntry
  score: number
}

/**
 * Select the most relevant memories for `query` within a token budget.
 * Relevance = BM25 × recency-decay × usage-boost. Then enforce per-session
 * diversity (so one chatty session can't dominate) and accumulate top-ranked
 * entries until the budget is hit. Returns the chosen entries, highest first.
 */
export function retrieve(
  entries: MemoryEntry[],
  query: string,
  opts: RetrieveOptions = {}
): MemoryEntry[] {
  const budget = opts.budgetTokens ?? 2000
  const maxPerSession = opts.maxPerSession ?? 3
  const halfLife = opts.halfLifeMs ?? 14 * DAY
  const now = opts.now ?? Date.now()

  const pool = opts.workspaceId
    ? entries.filter((e) => !e.workspaceId || e.workspaceId === opts.workspaceId)
    : entries
  if (pool.length === 0) return []

  const bm = new Map(rankBm25(query, pool.map((e) => ({ id: e.id, text: `${e.text} ${e.tags.join(' ')}` }))).map((h) => [h.id, h.score]))

  const scored: Scored[] = []
  for (const e of pool) {
    const rel = bm.get(e.id) ?? 0
    if (rel <= 0) continue
    const ageMs = Math.max(0, now - e.createdAt)
    const recency = Math.pow(0.5, ageMs / halfLife) // 1 at age 0, 0.5 at half-life
    const usage = 1 + Math.log1p(e.accessCount) * 0.25
    scored.push({ entry: e, score: rel * (0.4 + 0.6 * recency) * usage })
  }
  scored.sort((a, b) => b.score - a.score)

  const perSession = new Map<string, number>()
  const chosen: MemoryEntry[] = []
  let used = 0
  for (const { entry } of scored) {
    const key = entry.sessionId ?? '∅'
    const n = perSession.get(key) ?? 0
    if (n >= maxPerSession) continue
    const cost = estimateTokens(entry.text) + 2 // +2 for the bullet/label overhead
    if (used + cost > budget) continue
    chosen.push(entry)
    perSession.set(key, n + 1)
    used += cost
    if (used >= budget) break
  }
  return chosen
}

/** Render selected memories as a compact, kind-tagged bullet list for injection. */
export function assembleMemory(entries: MemoryEntry[]): string {
  if (entries.length === 0) return ''
  return entries.map((e) => `- (${e.kind}) ${e.text}`).join('\n')
}
