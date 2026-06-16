// Pure BM25 lexical ranker — the offline-first half of agentmemory's hybrid
// retrieval (BM25 + vector + graph with RRF fusion). Forge ships BM25 only for
// v1: it needs no embedding model and no network, which is exactly the
// local-only constraint. Vector recall is a documented later step. NO
// electron/SDK imports → unit-tested headlessly.

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are',
  'was', 'be', 'this', 'that', 'it', 'as', 'at', 'by', 'from', 'ran'
])

/** Lowercase, split on non-alphanumerics, drop stopwords + 1-char tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
}

export interface Bm25Doc {
  id: string
  text: string
}

export interface Bm25Hit {
  id: string
  score: number
}

const K1 = 1.5
const B = 0.75

/**
 * Rank docs against a query by BM25. Returns every doc with a positive score,
 * highest first. Builds the df/idf table over the supplied docs each call —
 * fine for Forge's memory sizes (hundreds–thousands of short facts); a caller
 * with a hot path would cache the index, but memory injection is once-per-turn.
 */
export function rankBm25(query: string, docs: Bm25Doc[]): Bm25Hit[] {
  const q = [...new Set(tokenize(query))]
  if (q.length === 0 || docs.length === 0) return []

  const toks = docs.map((d) => tokenize(d.text))
  const df = new Map<string, number>()
  for (const t of toks) {
    for (const term of new Set(t)) df.set(term, (df.get(term) ?? 0) + 1)
  }
  const N = docs.length
  const avgLen = toks.reduce((s, t) => s + t.length, 0) / N || 1

  const hits: Bm25Hit[] = []
  for (let i = 0; i < docs.length; i++) {
    const tf = new Map<string, number>()
    for (const term of toks[i]) tf.set(term, (tf.get(term) ?? 0) + 1)
    const len = toks[i].length
    let score = 0
    for (const term of q) {
      const f = tf.get(term)
      if (!f) continue
      const n = df.get(term) ?? 0
      // BM25 idf with the +1 smoothing that keeps it non-negative.
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * len) / avgLen)))
    }
    if (score > 0) hits.push({ id: docs[i].id, score })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits
}
