// Subprocess env + Forge workspace anchoring (docs/MAINTAINABILITY.md Phase 4).
// Extracted verbatim from the former src/main/agent.ts.

import { promises as fs } from 'fs'
import { join } from 'path'
import { resolveAuthEnv } from '../auth'
import { workspaceRoot } from '../projectSettings'

/** Build the subprocess env, applying auth overrides (undefined = delete). */
export async function buildEnv(): Promise<Record<string, string>> {
  const env: Record<string, string | undefined> = { ...process.env }
  const overrides = await resolveAuthEnv()
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  return Object.fromEntries(
    Object.entries(env).filter(([, v]) => v != null)
  ) as Record<string, string>
}

/**
 * Phase 0 — filesystem `.claude/` discovery.
 *
 * The SDK only finds project Skills / Commands / Agents / hooks / MCP when it is
 * (a) told which setting sources to read and (b) given a cwd whose `.claude/` is
 * the source of truth. process.cwd() is unreliable for this: in a packaged build
 * it's the (often read-only) install dir, and `~` is wiped on reboot on this
 * machine. So Forge anchors a stable, writable workspace under userData and
 * treats its `.claude/` as the project root for every run.
 *
 * 'user' + 'project' mirror the CLI defaults; 'local' is intentionally omitted.
 */
export const SETTING_SOURCES = ['user', 'project'] as const

// One in-flight/cached promise per workspace key ('' = shared root).
const workspaceReady = new Map<string, Promise<string>>()

/**
 * Path to Forge's persistent project workspace (its `.claude/` lives here).
 * @deprecated Import workspaceRoot from '../projectSettings' directly.
 */
export function workspaceDir(): string {
  return workspaceRoot()
}

/** Create the `.claude/{skills,commands,agents}` skeleton under `dir` (best-effort). */
async function ensureClaudeDirs(dir: string): Promise<void> {
  const claude = join(dir, '.claude')
  await Promise.all([
    fs.mkdir(join(claude, 'skills'), { recursive: true }),
    fs.mkdir(join(claude, 'commands'), { recursive: true }),
    fs.mkdir(join(claude, 'agents'), { recursive: true })
  ]).catch(() => {})
}

/**
 * Resolve a usable cwd for a run, creating it once and caching the result.
 *
 * - No `id` (or empty) → the shared root workspace (legacy single-conversation
 *   behavior; its `.claude/` is the source of truth for Skills/Commands/Agents).
 * - With an `id` → an ISOLATED per-conversation workspace at
 *   `<root>/ws/<id>/`, so concurrent agents in different conversations can't
 *   clobber each other's files. The root `.claude/` is linked in (junction on
 *   Windows — no admin needed; symlink elsewhere) so EXTEND config + settings are
 *   still seen. Any failure falls back to the shared root (never blocks a run).
 */
/**
 * Make an EXISTING recorded cwd usable for a resumed run: ensure the dir exists
 * and carries the shared root `.claude` (so Skills/Commands/Agents/settings still
 * load). Used when resuming a session in the exact dir the SDK stored it under,
 * which may differ from the tab's current workspace key (e.g. a session created
 * before workspace isolation, or after the renderer's session→ws map was lost on
 * restart). Falls back to the shared root on any failure (never blocks a run).
 */
export async function ensureResumeCwd(dir: string): Promise<string> {
  const root = workspaceRoot()
  await ensureClaudeDirs(root)
  try {
    if (dir === root) return root
    await fs.mkdir(dir, { recursive: true })
    const link = join(dir, '.claude')
    try {
      await fs.access(link)
    } catch {
      await fs.symlink(join(root, '.claude'), link, 'junction').catch(() => {})
    }
    return dir
  } catch {
    return root
  }
}

export function ensureWorkspace(id?: string): Promise<string> {
  const key = id && id.trim() ? id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) : ''
  let p = workspaceReady.get(key)
  if (!p) {
    p = (async () => {
      const root = workspaceRoot()
      await ensureClaudeDirs(root)
      if (!key) return root
      try {
        const dir = join(root, 'ws', key)
        await fs.mkdir(dir, { recursive: true })
        // Share the root .claude (config + settings) so the isolated workspace
        // still loads Skills/Commands/Agents/hooks; only file edits are isolated.
        const link = join(dir, '.claude')
        try {
          await fs.access(link)
        } catch {
          await fs.symlink(join(root, '.claude'), link, 'junction').catch(() => {})
        }
        return dir
      } catch {
        return root
      }
    })()
    workspaceReady.set(key, p)
  }
  return p
}
