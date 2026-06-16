// Pure repo-map builder — ranks the parsed files by importance and renders a
// compact, budget-bounded structural map for the agent to navigate by (the
// "graphs that teach" idea from Understand-Anything, rendered as text rather
// than a visual graph). Importance is a cheap PageRank-lite: a file matters more
// the more other files import it, plus its own surface area, minus its depth.
// NO electron/SDK imports → unit-tested headlessly.

import type { FileNode } from './parse'

export interface RepoMapOptions {
  /** Max files listed. Default 60. */
  maxFiles?: number
  /** Max symbols shown per file. Default 12. */
  maxSymbolsPerFile?: number
}

/** Strip extension + leading ./; used to match an import specifier to a file. */
function baseKey(path: string): string {
  return path.replace(/\.[a-z0-9]+$/i, '').replace(/\/index$/, '').replace(/^\.\//, '')
}

/**
 * Rank files most-important first. Score = 3×(times imported by other files) +
 * exports + 0.5×symbols − pathDepth. Deterministic (ties break on path), so the
 * same tree always renders the same map.
 */
export function rankFiles(files: FileNode[]): FileNode[] {
  // Map every file's base key (and basename) so imports can be resolved to it.
  const byKey = new Map<string, FileNode>()
  for (const f of files) {
    byKey.set(baseKey(f.path), f)
    const base = baseKey(f.path).split('/').pop()
    if (base) byKey.set(base, byKey.get(base) ?? f) // first wins on basename clashes
  }

  const importedBy = new Map<string, number>()
  for (const f of files) {
    for (const spec of f.imports) {
      const key = baseKey(spec.replace(/^[./]+/, ''))
      const target = byKey.get(key) ?? byKey.get(key.split('/').pop() ?? '')
      if (target && target.path !== f.path) {
        importedBy.set(target.path, (importedBy.get(target.path) ?? 0) + 1)
      }
    }
  }

  const score = (f: FileNode): number =>
    3 * (importedBy.get(f.path) ?? 0) +
    f.exports.length +
    0.5 * f.symbols.length -
    f.path.split('/').length

  return files
    .slice()
    .sort((a, b) => score(b) - score(a) || a.path.localeCompare(b.path))
}

/** Render the ranked files as a compact text map. */
export function buildRepoMap(files: FileNode[], opts: RepoMapOptions = {}): string {
  const maxFiles = opts.maxFiles ?? 60
  const maxSym = opts.maxSymbolsPerFile ?? 12
  if (files.length === 0) return ''

  const ranked = rankFiles(files).slice(0, maxFiles)
  const lines: string[] = []
  for (const f of ranked) {
    lines.push(`${f.path} (${f.lang}, ${f.loc} loc)`)
    if (f.exports.length) lines.push(`  exports: ${f.exports.slice(0, maxSym).join(', ')}`)
    const sym = f.symbols
      .slice(0, maxSym)
      .map((s) => `${s.kind} ${s.name}`)
      .join(', ')
    if (sym) lines.push(`  ${sym}${f.symbols.length > maxSym ? ', …' : ''}`)
  }
  if (files.length > maxFiles) lines.push(`… (+${files.length - maxFiles} more files)`)
  return lines.join('\n')
}
