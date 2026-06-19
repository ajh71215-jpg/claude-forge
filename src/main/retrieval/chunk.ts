// Pure line-window chunker for content retrieval (RAG). Splits a file's text into
// overlapping fixed-size line windows so BM25 can rank passages, not whole files.
// Overlap keeps a symbol that straddles a boundary findable from either window.
// Deliberately simple (no AST/semantic chunking) and PURE → unit-tested headlessly.

export interface Chunk {
  /** Stable id `<path>#<startLine>`. */
  id: string
  path: string
  /** 1-based first line of the chunk. */
  startLine: number
  text: string
}

export interface ChunkOptions {
  /** Lines per window. Default 40. */
  maxLines?: number
  /** Overlapping lines between consecutive windows. Default 8. */
  overlap?: number
}

/**
 * Chunk one file's content into overlapping line windows. Blank/whitespace-only
 * windows are dropped (nothing to retrieve). Never throws.
 */
export function chunkFile(path: string, content: string, options: ChunkOptions = {}): Chunk[] {
  const maxLines = Math.max(1, Math.floor(options.maxLines ?? 40))
  const overlap = Math.min(maxLines - 1, Math.max(0, Math.floor(options.overlap ?? 8)))
  const step = maxLines - overlap
  const lines = content.split('\n')
  const out: Chunk[] = []
  for (let start = 0; start < lines.length; start += step) {
    const slice = lines.slice(start, start + maxLines)
    const text = slice.join('\n')
    if (text.trim().length === 0) continue
    out.push({ id: `${path}#${start + 1}`, path, startLine: start + 1, text })
    if (start + maxLines >= lines.length) break
  }
  return out
}
