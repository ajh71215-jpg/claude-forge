// Persistent memory store (Forge-private forge-memory.json, no external DB —
// the local-only constraint). Holds the captured entries + the global enable
// flag, with dedupe, usage strengthening, and decay-based eviction (agentmemory's
// "frequently accessed strengthen; stale auto-evict"). Electron-touching (uses
// projectSettings) so it lives apart from the pure cores tested by `npm test`.

import { readForgeConfig, writeForgeConfig } from '../projectSettings'
import { rankBm25 } from './bm25'
import type { MemoryEntry } from './types'

const FILE = 'forge-memory.json'
const MAX_ENTRIES = 4000

interface MemoryConfig {
  enabled?: boolean
  budgetTokens?: number
  entries?: MemoryEntry[]
}

type Candidate = Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccess' | 'accessCount'>

async function read(): Promise<Required<MemoryConfig>> {
  const c = await readForgeConfig<MemoryConfig>(FILE, {})
  return {
    enabled: c.enabled ?? true, // on by default; a no-op until memories accrue
    budgetTokens: c.budgetTokens ?? 1500,
    entries: Array.isArray(c.entries) ? c.entries : []
  }
}
async function write(c: Required<MemoryConfig>): Promise<void> {
  await writeForgeConfig(FILE, c)
}

export async function isMemoryEnabled(): Promise<boolean> {
  return (await read()).enabled
}
export async function memoryBudgetTokens(): Promise<number> {
  return (await read()).budgetTokens
}
export async function setMemoryEnabled(on: boolean): Promise<boolean> {
  const c = await read()
  c.enabled = on
  await write(c)
  return on
}

/** Decay×usage score used for eviction (lowest are forgotten first). */
function evictionScore(e: MemoryEntry, now: number): number {
  const ageDays = Math.max(0, now - e.createdAt) / 86_400_000
  const recency = Math.pow(0.5, ageDays / 30)
  return recency * (1 + Math.log1p(e.accessCount))
}

/**
 * Add an observation. Dedupes by hash (identical observations collapse and just
 * bump usage), then evicts the weakest entries if over the cap. Returns the
 * stored entry, or null when memory is disabled.
 */
export async function addMemory(cand: Candidate): Promise<MemoryEntry | null> {
  const c = await read()
  if (!c.enabled) return null
  const now = Date.now()
  const existing = c.entries.find((e) => e.hash === cand.hash)
  if (existing) {
    existing.accessCount += 1
    existing.lastAccess = now
    await write(c)
    return existing
  }
  const entry: MemoryEntry = { ...cand, id: cand.hash, createdAt: now, lastAccess: now, accessCount: 0 }
  c.entries.push(entry)
  if (c.entries.length > MAX_ENTRIES) {
    c.entries.sort((a, b) => evictionScore(b, now) - evictionScore(a, now))
    c.entries = c.entries.slice(0, MAX_ENTRIES)
  }
  await write(c)
  return entry
}

export async function listMemories(): Promise<MemoryEntry[]> {
  return (await read()).entries.slice().sort((a, b) => b.createdAt - a.createdAt)
}

/** Lexical search for the Memory panel (newest-first within relevance). */
export async function searchMemories(query: string): Promise<MemoryEntry[]> {
  const entries = (await read()).entries
  if (!query.trim()) return entries.slice().sort((a, b) => b.createdAt - a.createdAt)
  const ranked = rankBm25(query, entries.map((e) => ({ id: e.id, text: `${e.text} ${e.tags.join(' ')}` })))
  const byId = new Map(entries.map((e) => [e.id, e]))
  return ranked.map((h) => byId.get(h.id)!).filter(Boolean)
}

/** Strengthen entries that were just recalled (agentmemory's usage reinforcement). */
export async function recordAccess(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const c = await read()
  const set = new Set(ids)
  const now = Date.now()
  let touched = false
  for (const e of c.entries) {
    if (set.has(e.id)) {
      e.accessCount += 1
      e.lastAccess = now
      touched = true
    }
  }
  if (touched) await write(c)
}

export async function deleteMemory(id: string): Promise<MemoryEntry[]> {
  const c = await read()
  c.entries = c.entries.filter((e) => e.id !== id)
  await write(c)
  return listMemories()
}

export async function clearMemories(): Promise<void> {
  const c = await read()
  c.entries = []
  await write(c)
}

/** Read-only accessor used by the injection helper. */
export async function allMemories(): Promise<MemoryEntry[]> {
  return (await read()).entries
}
