// Filesystem scan for the repo map (Understand-Anything absorption). Walks a
// workspace cwd, parses source files into FileNodes, and computes a fingerprint
// so the built map can be cached and only rebuilt when files actually change
// (Understand-Anything's "fingerprint-based incremental updates"). fs/path only
// — no electron — but kept apart from the pure parser/builder that `npm test`
// covers, since walking the disk isn't unit-testable headlessly.

import { promises as fs } from 'fs'
import { join, relative } from 'path'
import { detectLang, parseFile, type FileNode } from './parse'

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.claude', 'ws', 'dist', 'out', 'out-test', 'out-selftest',
  'build', 'coverage', '.next', '.cache', '.venv', 'venv', '__pycache__', 'vendor',
  'target', '.idea', '.vscode', 'resources'
])
const MAX_BYTES = 256 * 1024
const MAX_FILES = 500

export interface ScanResult {
  files: FileNode[]
  fileCount: number
  fingerprint: string
  truncated: boolean
}

async function walk(root: string, dir: string, out: { rel: string; size: number; mtime: number }[]): Promise<void> {
  if (out.length >= MAX_FILES) return
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return
    if (e.name.startsWith('.') && e.name !== '.') {
      if (e.isDirectory()) continue // skip dot-dirs
    }
    const abs = join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      await walk(root, abs, out)
    } else if (e.isFile()) {
      if (detectLang(e.name) === 'other') continue // source code only
      let st: import('fs').Stats
      try {
        st = await fs.stat(abs)
      } catch {
        continue
      }
      if (st.size > MAX_BYTES || st.size === 0) continue
      out.push({ rel: relative(root, abs).replace(/\\/g, '/'), size: st.size, mtime: Math.floor(st.mtimeMs) })
    }
  }
}

/** FNV-1a over the (path:size:mtime) list — cheap change-detection fingerprint. */
function fingerprintOf(list: { rel: string; size: number; mtime: number }[]): string {
  const s = list
    .slice()
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map((f) => `${f.rel}:${f.size}:${f.mtime}`)
    .join('|')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16)
}

/** Walk + parse the source files under `root`. Best-effort; never throws. */
export async function scanRepo(root: string): Promise<ScanResult> {
  const found: { rel: string; size: number; mtime: number }[] = []
  await walk(root, root, found).catch(() => {})
  const truncated = found.length >= MAX_FILES
  const files: FileNode[] = []
  for (const f of found) {
    try {
      const content = await fs.readFile(join(root, f.rel), 'utf8')
      files.push(parseFile(f.rel, content))
    } catch {
      /* skip unreadable/binary */
    }
  }
  return { files, fileCount: files.length, fingerprint: fingerprintOf(found), truncated }
}
