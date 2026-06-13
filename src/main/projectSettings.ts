import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

/**
 * Shared paths + JSON helpers for Forge's persistent project workspace.
 *
 * `.claude/` here is the source of truth the SDK reads (settingSources includes
 * 'project'). `settings.json` holds hooks; Forge-only config (mcp/plugins/skill
 * toggles) lives in sibling `forge-*.json` files OUTSIDE `.claude/` so the SDK
 * never mis-parses them as project config.
 */

export function workspaceRoot(): string {
  return join(app.getPath('userData'), 'workspace')
}
export function claudeDir(): string {
  return join(workspaceRoot(), '.claude')
}
export function settingsPath(): string {
  return join(claudeDir(), 'settings.json')
}

export async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const o = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  await fs.mkdir(claudeDir(), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
}

/** Read a Forge-private JSON config from the workspace root (not under .claude). */
export async function readForgeConfig<T>(file: string, fallback: T): Promise<T> {
  try {
    const o = JSON.parse(await fs.readFile(join(workspaceRoot(), file), 'utf8'))
    return o ?? fallback
  } catch {
    return fallback
  }
}

export async function writeForgeConfig(file: string, data: unknown): Promise<void> {
  await fs.mkdir(workspaceRoot(), { recursive: true })
  await fs.writeFile(join(workspaceRoot(), file), JSON.stringify(data, null, 2), 'utf8')
}
