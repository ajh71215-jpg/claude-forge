// Repo map (Understand-Anything absorption). Barrel + the cached map builder and
// the injection helper runStreaming uses to give a fresh conversation a
// structural map of its workspace — so the agent navigates by map instead of
// burning tokens on exploratory globs/reads (retrieval-first).

import { compressText } from '../efficiency/compress'
import { scanRepo } from './scan'
import { buildRepoMap } from './build'

export { parseFile, detectLang } from './parse'
export type { FileNode, Lang, SourceSymbol } from './parse'
export { buildRepoMap, rankFiles } from './build'

const REPO_MAP_BUDGET = 1200 // tokens injected at most

export interface RepoMapResult {
  map: string
  fileCount: number
  fingerprint: string
  truncated: boolean
}

// Cache the rendered map per cwd+fingerprint so a repeated scan of an unchanged
// tree is free (Understand-Anything's incremental principle).
const cache = new Map<string, RepoMapResult>()

/** Build (or reuse) the repo map for a workspace cwd. Best-effort; never throws. */
export async function getRepoMap(cwd: string): Promise<RepoMapResult> {
  try {
    const scan = await scanRepo(cwd)
    const cached = cache.get(cwd)
    if (cached && cached.fingerprint === scan.fingerprint) return cached
    const result: RepoMapResult = {
      map: buildRepoMap(scan.files),
      fileCount: scan.fileCount,
      fingerprint: scan.fingerprint,
      truncated: scan.truncated
    }
    cache.set(cwd, result)
    return result
  } catch {
    return { map: '', fileCount: 0, fingerprint: '', truncated: false }
  }
}

export interface RepoMapInjection {
  text: string
  fileCount: number
}

/**
 * Build the repo-map block to prepend to a fresh conversation. Returns '' when
 * the workspace has no source files (so callers inject unconditionally). The map
 * is compressed to a fixed token budget and wrapped with a short caveat.
 */
export async function buildRepoMapInjection(cwd: string): Promise<RepoMapInjection> {
  const { map, fileCount } = await getRepoMap(cwd)
  if (!map.trim()) return { text: '', fileCount: 0 }
  const body = compressText(map, { maxTokens: REPO_MAP_BUDGET }).text
  const text =
    '<repo-map>\n' +
    'A structural map of this workspace (most-imported files first). Use it to ' +
    'locate code without exhaustive searching; open a file to see full detail.\n' +
    body +
    '\n</repo-map>'
  return { text, fileCount }
}
