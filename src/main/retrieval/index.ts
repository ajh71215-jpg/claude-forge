// Content retrieval (RAG) — the report's "top-k relevant chunks, not whole files"
// lever (§6.2), plus a model-free flavor of Anthropic's Contextual Retrieval: each
// retrieved chunk is prefixed with its `path:line` provenance (the cheap,
// no-extra-model substitute for an LLM-written context sentence). Reuses the
// existing pure BM25 ranker (memory/bm25). Injected on FRESH conversations only
// (cache-stable prefix), budget-bounded, and naturally gated — BM25 returns chunks
// only when the query's terms actually occur, so an unrelated prompt injects
// nothing.

import { rankBm25, tokenize, type Bm25Doc } from '../memory/bm25'
import { compressText, estimateTokens } from '../efficiency/compress'
import { chunkFile, type Chunk } from './chunk'
import { scanContent } from './scan'

const RAG_BUDGET = 1200 // max tokens injected
const TOP_K = 6 // max chunks considered
const MIN_QUERY_TOKENS = 3 // don't retrieve for trivial prompts ("hi", "thanks")
const MAX_CHUNK_TOKENS = 320 // clip an over-long single chunk before it enters the budget

interface IndexEntry {
  fingerprint: string
  chunks: Chunk[]
}
// Cache the (expensive) chunked index per cwd+fingerprint; only the ranking — which
// depends on the per-turn query — runs each call.
const cache = new Map<string, IndexEntry>()

async function getIndex(cwd: string): Promise<Chunk[]> {
  const scan = await scanContent(cwd)
  const cached = cache.get(cwd)
  if (cached && cached.fingerprint === scan.fingerprint) return cached.chunks
  const chunks: Chunk[] = []
  for (const f of scan.files) chunks.push(...chunkFile(f.path, f.content))
  cache.set(cwd, { fingerprint: scan.fingerprint, chunks })
  return chunks
}

export interface RetrievalInjection {
  text: string
  chunkCount: number
}

/**
 * Build the retrieved-context block for a fresh conversation: the top-k workspace
 * content chunks most relevant to `query`, each tagged with `path:line`, within a
 * fixed token budget. Returns '' when nothing relevant is found (trivial query, no
 * term overlap, or empty workspace) so callers inject unconditionally. Never throws.
 */
export async function buildRetrievalInjection(
  cwd: string,
  query: string
): Promise<RetrievalInjection> {
  try {
    if (new Set(tokenize(query)).size < MIN_QUERY_TOKENS) return { text: '', chunkCount: 0 }
    const chunks = await getIndex(cwd)
    if (chunks.length === 0) return { text: '', chunkCount: 0 }

    const docs: Bm25Doc[] = chunks.map((c) => ({ id: c.id, text: c.text }))
    const hits = rankBm25(query, docs)
    if (hits.length === 0) return { text: '', chunkCount: 0 }

    const byId = new Map(chunks.map((c) => [c.id, c]))
    const blocks: string[] = []
    let used = 0
    let count = 0
    for (const hit of hits.slice(0, TOP_K)) {
      const c = byId.get(hit.id)
      if (!c) continue
      const body = compressText(c.text, { maxTokens: MAX_CHUNK_TOKENS }).text
      // Model-free "contextual" header: provenance the model can act on (open file).
      const block = `// ${c.path}:${c.startLine}\n${body}`
      const cost = estimateTokens(block) + 1
      if (used + cost > RAG_BUDGET) break
      blocks.push(block)
      used += cost
      count++
    }
    if (count === 0) return { text: '', chunkCount: 0 }

    const text =
      '<retrieved-context>\n' +
      'Workspace passages most relevant to the request (path:line shown). Treat as ' +
      'hints to locate code — open the file to confirm; content may be stale.\n\n' +
      blocks.join('\n\n') +
      '\n</retrieved-context>'
    return { text, chunkCount: count }
  } catch {
    return { text: '', chunkCount: 0 }
  }
}
