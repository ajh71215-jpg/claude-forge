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

let workspaceReady: Promise<string> | null = null

/**
 * Path to Forge's persistent project workspace (its `.claude/` lives here).
 * @deprecated Import workspaceRoot from '../projectSettings' directly.
 */
export function workspaceDir(): string {
  return workspaceRoot()
}

/**
 * Create the workspace and its `.claude/` skill/command/agent dirs once, then
 * reuse the cached result. Best-effort: the SDK tolerates a missing `.claude/`,
 * so a mkdir failure still yields a usable cwd.
 */
export function ensureWorkspace(): Promise<string> {
  if (!workspaceReady) {
    const dir = workspaceRoot()
    const claude = join(dir, '.claude')
    workspaceReady = Promise.all([
      fs.mkdir(join(claude, 'skills'), { recursive: true }),
      fs.mkdir(join(claude, 'commands'), { recursive: true }),
      fs.mkdir(join(claude, 'agents'), { recursive: true })
    ])
      .then(() => dir)
      .catch(() => dir)
  }
  return workspaceReady
}
