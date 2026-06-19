// Pure response cache (GPTCache / semantic-cache family, arXiv:2411.05276): skip
// re-running the model for an equivalent query by returning a stored answer.
//
// HONEST LIMIT: Forge is local-only with no in-process embedding model, so this
// is NOT true semantic (vector) caching — it matches on a NORMALIZED-EXACT key
// (default) or an optional lexical token-set similarity (Jaccard) above a high
// threshold. The report flags false positives ("silently wrong answers") as the
// key risk, so the default threshold is 1.0 (exact-normalized) and callers must
// opt into fuzzy matching. It is meant for self-contained, low-stakes, read-only
// work (e.g. the goose `delegate` subtasks), never for stateful agentic turns
// where the same prompt can legitimately need a different answer.
// NO electron/SDK imports → unit-tested headlessly.

import { tokenize } from '../memory/bm25'

export interface ResponseCacheOptions {
  /** LRU capacity. Default 200. */
  maxEntries?: number
  /** Entry lifetime in ms (staleness guard). Default 5 min. */
  ttlMs?: number
  /** Lexical-similarity hit threshold 0..1. 1 = normalized-exact only (default,
   *  safest). <1 enables fuzzy Jaccard matching (use with care). */
  threshold?: number
  /** Injectable clock for tests. Default Date.now. */
  now?: () => number
}

interface Entry<V> {
  key: string
  tokens: Set<string>
  value: V
  at: number
}

export interface ResponseCache<V> {
  get(query: string): V | undefined
  set(query: string, value: V): void
  size(): number
}

/** Lowercase, collapse whitespace, trim — the normalized-exact match key. */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Jaccard overlap of two token sets, 0..1. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

export function createResponseCache<V>(options: ResponseCacheOptions = {}): ResponseCache<V> {
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 200))
  const ttlMs = Math.max(0, options.ttlMs ?? 5 * 60_000)
  const threshold = Math.min(1, Math.max(0, options.threshold ?? 1))
  const now = options.now ?? Date.now
  // Most-recently-used at the end; front is the LRU eviction target.
  const entries: Entry<V>[] = []

  function dropExpired(t: number): void {
    if (ttlMs <= 0) return
    for (let i = entries.length - 1; i >= 0; i--) {
      if (t - entries[i].at > ttlMs) entries.splice(i, 1)
    }
  }

  function get(query: string): V | undefined {
    const t = now()
    dropExpired(t)
    const key = normalize(query)
    const qtok = new Set(tokenize(query))
    let bestIdx = -1
    let best = 0
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].key === key) {
        bestIdx = i
        break // exact-normalized always wins
      }
      if (threshold < 1) {
        const s = jaccard(qtok, entries[i].tokens)
        if (s >= threshold && s > best) {
          best = s
          bestIdx = i
        }
      }
    }
    if (bestIdx < 0) return undefined
    const [hit] = entries.splice(bestIdx, 1)
    hit.at = t
    entries.push(hit) // LRU bump
    return hit.value
  }

  function set(query: string, value: V): void {
    const t = now()
    dropExpired(t)
    const key = normalize(query)
    const existing = entries.findIndex((e) => e.key === key)
    if (existing >= 0) entries.splice(existing, 1)
    entries.push({ key, tokens: new Set(tokenize(query)), value, at: t })
    while (entries.length > maxEntries) entries.shift() // evict LRU
  }

  return { get, set, size: () => entries.length }
}
