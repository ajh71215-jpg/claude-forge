// Progressive disclosure for memory — the portable idea cherry-picked from
// thedotmack/claude-mem (MIT): instead of dumping full observation text into the
// context, expose a three-stage, graduated-detail retrieval so the model spends
// tokens only on what it has already qualified as relevant:
//
//   1. search   → a compact INDEX (id + kind + ~90-char snippet). Cheap to scan.
//   2. timeline → the chronological NEIGHBORS of chosen ids (what was happening
//                 around them) — context to judge relevance before fetching detail.
//   3. get      → the FULL records for a filtered id set only.
//
// claude-mem reports ~10x savings from "filter before fetching details". Forge's
// version is pure + local: it ranks with the existing BM25 core, needs no DB and
// no model, and (unlike claude-mem's SQLite+Chroma worker) reuses Forge's own
// MemoryEntry store. NO electron/SDK imports → unit-tested headlessly.

import { rankBm25 } from './bm25'
import type { MemoryEntry, MemoryKind } from './types'

const SNIPPET_CHARS = 90

/** Collapse whitespace and clip to a token-cheap one-liner. */
function snippet(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= SNIPPET_CHARS ? t : t.slice(0, SNIPPET_CHARS - 1).trimEnd() + '…'
}

/** Stage 1/2 row: identity + just enough to decide whether to fetch the detail. */
export interface MemoryIndexRow {
  id: string
  kind: MemoryKind
  snippet: string
  tags: string[]
  createdAt: number
  sessionId?: string
}

/** Stage 3 record: the full stored fact. */
export interface MemoryRecord {
  id: string
  kind: MemoryKind
  text: string
  tags: string[]
  source: string
  createdAt: number
  accessCount: number
  sessionId?: string
}

function toRow(e: MemoryEntry): MemoryIndexRow {
  const row: MemoryIndexRow = {
    id: e.id,
    kind: e.kind,
    snippet: snippet(e.text),
    tags: e.tags,
    createdAt: e.createdAt
  }
  if (e.sessionId) row.sessionId = e.sessionId
  return row
}

export interface SearchOptions {
  /** Max rows returned. Default 10. */
  limit?: number
  /** Restrict to one memory kind. */
  kind?: MemoryKind
  /** Only entries created at/after this epoch-ms. */
  sinceMs?: number
  /** Scope to a workspace (entries without a workspaceId always match). */
  workspaceId?: string
}

/**
 * Stage 1 — search. Rank entries for `query` (BM25 over text+tags) and return a
 * compact index. An empty query lists the most recent entries (browse mode).
 * Filters (kind/since/workspace) apply before ranking.
 */
export function searchIndex(
  entries: MemoryEntry[],
  query: string,
  opts: SearchOptions = {}
): MemoryIndexRow[] {
  const limit = Math.max(1, opts.limit ?? 10)
  let pool = entries
  if (opts.workspaceId)
    pool = pool.filter((e) => !e.workspaceId || e.workspaceId === opts.workspaceId)
  if (opts.kind) pool = pool.filter((e) => e.kind === opts.kind)
  if (opts.sinceMs != null) pool = pool.filter((e) => e.createdAt >= opts.sinceMs!)
  if (pool.length === 0) return []

  let ordered: MemoryEntry[]
  if (query.trim()) {
    const ranked = rankBm25(
      query,
      pool.map((e) => ({ id: e.id, text: `${e.text} ${e.tags.join(' ')}` }))
    )
    const byId = new Map(pool.map((e) => [e.id, e]))
    ordered = ranked.map((h) => byId.get(h.id)).filter((e): e is MemoryEntry => !!e)
  } else {
    ordered = pool.slice().sort((a, b) => b.createdAt - a.createdAt)
  }
  return ordered.slice(0, limit).map(toRow)
}

export interface TimelineRow extends MemoryIndexRow {
  /** ms from the reference anchor's createdAt (negative = earlier). */
  deltaMs: number
}

export interface TimelineOptions {
  /** Half-window around each anchor, in ms. Default 1 hour. */
  windowMs?: number
  /** Max rows returned. Default 12. */
  limit?: number
  /** Restrict neighbors to the anchors' own session(s). Default false. */
  sameSession?: boolean
}

/**
 * Stage 2 — timeline. Given anchor ids (from a search), return their
 * chronological neighbors: entries created within ±windowMs of any anchor,
 * sorted oldest→newest, each tagged with deltaMs from the reference anchor (the
 * earliest one). Lets the model see "what was happening around" a hit before
 * paying for full detail. Unknown ids are ignored; empty anchors ⇒ [].
 */
export function timeline(
  entries: MemoryEntry[],
  anchorIds: string[],
  opts: TimelineOptions = {}
): TimelineRow[] {
  const windowMs = opts.windowMs ?? 3_600_000
  const limit = Math.max(1, opts.limit ?? 12)
  const byId = new Map(entries.map((e) => [e.id, e]))
  const anchors = anchorIds.map((id) => byId.get(id)).filter((e): e is MemoryEntry => !!e)
  if (anchors.length === 0) return []

  const reference = anchors.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b))
  const sessions = new Set(anchors.map((a) => a.sessionId))

  const chosen: MemoryEntry[] = []
  const seen = new Set<string>()
  for (const e of entries) {
    if (seen.has(e.id)) continue
    if (opts.sameSession && !sessions.has(e.sessionId)) continue
    const near = anchors.some((a) => Math.abs(e.createdAt - a.createdAt) <= windowMs)
    if (!near) continue
    seen.add(e.id)
    chosen.push(e)
  }
  chosen.sort((a, b) => a.createdAt - b.createdAt)
  return chosen.slice(0, limit).map((e) => ({
    ...toRow(e),
    deltaMs: e.createdAt - reference.createdAt
  }))
}

/**
 * Stage 3 — get. Return the FULL records for `ids`, in the requested order,
 * skipping unknown ids. This is the only stage that surfaces complete text, so
 * the caller pays the big tokens only for the pre-qualified set.
 */
export function getRecords(entries: MemoryEntry[], ids: string[]): MemoryRecord[] {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const out: MemoryRecord[] = []
  for (const id of ids) {
    const e = byId.get(id)
    if (!e) continue
    const rec: MemoryRecord = {
      id: e.id,
      kind: e.kind,
      text: e.text,
      tags: e.tags,
      source: e.source,
      createdAt: e.createdAt,
      accessCount: e.accessCount
    }
    if (e.sessionId) rec.sessionId = e.sessionId
    out.push(rec)
  }
  return out
}
