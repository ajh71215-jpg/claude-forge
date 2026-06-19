// Filesystem content scan for RAG retrieval. Unlike repomap/scan (which parses
// files into structural symbols and discards the text), this keeps the raw
// content so it can be chunked + BM25-indexed. fs/path only — no electron — and
// kept apart from the pure chunker that `npm test` covers (disk walks aren't
// unit-testable headlessly). Best-effort; never throws.

import { promises as fs } from 'fs'
import { join, relative } from 'path'
import { detectLang } from '../repomap/parse'

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.claude', 'ws', 'dist', 'out', 'out-test', 'out-selftest',
  'build', 'coverage', '.next', '.cache', '.venv', 'venv', '__pycache__', 'vendor',
  'target', '.idea', '.vscode', 'resources'
])
const MAX_BYTES = 128 * 1024
const MAX_FILES = 400

export interface ContentFile {
  path: string
  content: string
}
export interface ContentScan {
  files: ContentFile[]
  fingerprint: string
  truncated: boolean
}

async function walk(
  root: string,
  dir: string,
  out: { rel: string; size: number; mtime: number }[]
): Promise<void> {
  if (out.length >= MAX_FILES) return
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return
    if (e.name.startsWith('.') && e.isDirectory()) continue
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
      out.push({
        rel: relative(root, abs).replace(/\\/g, '/'),
        size: st.size,
        mtime: Math.floor(st.mtimeMs)
      })
    }
  }
}

/** FNV-1a over (path:size:mtime) — cheap change-detection fingerprint. */
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

export async function scanContent(root: string): Promise<ContentScan> {
  const found: { rel: string; size: number; mtime: number }[] = []
  await walk(root, root, found).catch(() => {})
  const truncated = found.length >= MAX_FILES
  const files: ContentFile[] = []
  for (const f of found) {
    try {
      files.push({ path: f.rel, content: await fs.readFile(join(root, f.rel), 'utf8') })
    } catch {
      /* skip unreadable/binary */
    }
  }
  return { files, fingerprint: fingerprintOf(found), truncated }
}
