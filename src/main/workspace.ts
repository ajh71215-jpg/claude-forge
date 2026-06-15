// Per-conversation workspace inspection. Each conversation runs in an isolated
// cwd at <workspaceRoot>/ws/<id>/ (see agent/env.ts); this lets the UI show what
// the agent actually created/edited there — a local read, no model, no tokens.
import { promises as fs } from 'fs'
import { join, relative, sep } from 'path'
import { workspaceRoot } from './projectSettings'

export interface WorkspaceFile {
  /** Path relative to the workspace root, forward-slashed. */
  path: string
  size: number
  mtime: number
}

// Skip the linked-in shared config + heavy/irrelevant dirs.
const IGNORE = new Set(['.claude', 'node_modules', '.git', '.DS_Store'])

/** Sanitize a workspace id to the same charset agent/env.ts uses for the dir. */
function safeKey(id: string): string {
  return id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
}

/** List files the agent created/edited in a conversation's workspace, newest first. */
export async function listWorkspace(id: string): Promise<WorkspaceFile[]> {
  const key = safeKey(id)
  if (!key) return []
  const root = join(workspaceRoot(), 'ws', key)
  const out: WorkspaceFile[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6 || out.length > 500) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (!entries) return
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full, depth + 1)
      } else if (e.isFile()) {
        try {
          const st = await fs.stat(full)
          out.push({ path: relative(root, full).split(sep).join('/'), size: st.size, mtime: st.mtimeMs })
        } catch {
          /* skip */
        }
      }
    }
  }
  await walk(root, 0)
  return out.sort((a, b) => b.mtime - a.mtime)
}

/** Read one workspace file's contents (capped). Path-traversal safe. */
export async function readWorkspaceFile(id: string, rel: string): Promise<string> {
  const key = safeKey(id)
  if (!key) return ''
  const root = join(workspaceRoot(), 'ws', key)
  const safeRel = rel
    .split(/[\\/]/)
    .filter((s) => s && s !== '..' && s !== '.')
    .join('/')
  const full = join(root, safeRel)
  if (full !== root && !full.startsWith(root + sep)) return '' // escape guard
  try {
    const st = await fs.stat(full)
    if (!st.isFile()) return ''
    if (st.size > 200_000) return `(file too large to preview — ${(st.size / 1024).toFixed(0)} KB)`
    return await fs.readFile(full, 'utf8')
  } catch {
    return ''
  }
}
