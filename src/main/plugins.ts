import { promises as fs } from 'fs'
import { join } from 'path'
import { readForgeConfig, writeForgeConfig } from './projectSettings'

/**
 * Plugins (roadmap #6) — the umbrella that bundles skills + commands + hooks +
 * agents. The SDK currently supports `type: 'local'` plugins (a directory with a
 * `.claude-plugin/plugin.json` manifest). Forge stores the registered paths in a
 * private `forge-plugins.json` and passes them to the SDK `plugins` option
 * (agent.ts). One enabled flag per path lets you keep a plugin registered but off.
 */

export interface PluginEntry {
  path: string
  enabled: boolean
  /** Resolved at list-time: does the dir + manifest exist, and its declared name. */
  exists?: boolean
  manifestName?: string
  error?: string
}

export type PluginSaveResult =
  | { ok: true; plugins: PluginEntry[] }
  | { ok: false; error: string }

const FILE = 'forge-plugins.json'

interface Stored {
  path: string
  enabled: boolean
}

async function readAll(): Promise<Stored[]> {
  const cfg = await readForgeConfig<{ plugins?: Stored[] }>(FILE, { plugins: [] })
  return Array.isArray(cfg.plugins)
    ? cfg.plugins.filter((p) => p && typeof p.path === 'string').map((p) => ({ path: p.path, enabled: p.enabled !== false }))
    : []
}
async function writeAll(plugins: Stored[]): Promise<void> {
  await writeForgeConfig(FILE, { plugins })
}

/** Inspect a plugin dir: confirm it exists and read its manifest name if present. */
async function inspect(path: string): Promise<{ exists: boolean; manifestName?: string; error?: string }> {
  try {
    const stat = await fs.stat(path)
    if (!stat.isDirectory()) return { exists: false, error: 'Not a directory' }
  } catch {
    return { exists: false, error: 'Path not found' }
  }
  try {
    const raw = await fs.readFile(join(path, '.claude-plugin', 'plugin.json'), 'utf8')
    const m = JSON.parse(raw)
    return { exists: true, manifestName: typeof m?.name === 'string' ? m.name : undefined }
  } catch {
    // Directory exists but no manifest — still usable by some setups; flag it.
    return { exists: true, error: 'No .claude-plugin/plugin.json manifest' }
  }
}

export async function listPlugins(): Promise<PluginEntry[]> {
  const stored = await readAll()
  const out: PluginEntry[] = []
  for (const s of stored) {
    const info = await inspect(s.path)
    out.push({ path: s.path, enabled: s.enabled, ...info })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export async function addPlugin(path: string): Promise<PluginSaveResult> {
  const p = (path || '').trim()
  if (!p) return { ok: false, error: 'Enter a plugin directory path.' }
  const stored = await readAll()
  if (stored.some((s) => s.path === p)) return { ok: false, error: 'That path is already registered.' }
  const info = await inspect(p)
  if (!info.exists) return { ok: false, error: info.error ?? 'Path not found.' }
  stored.push({ path: p, enabled: true })
  await writeAll(stored)
  return { ok: true, plugins: await listPlugins() }
}

export async function setPluginEnabled(path: string, enabled: boolean): Promise<PluginEntry[]> {
  const stored = await readAll()
  const s = stored.find((x) => x.path === path)
  if (s) {
    s.enabled = enabled
    await writeAll(stored)
  }
  return listPlugins()
}

export async function removePlugin(path: string): Promise<PluginEntry[]> {
  await writeAll((await readAll()).filter((s) => s.path !== path))
  return listPlugins()
}

/** Enabled plugins as the SDK `plugins` option shape. */
export async function toSdkPlugins(): Promise<Array<{ type: 'local'; path: string }>> {
  return (await readAll())
    .filter((s) => s.enabled)
    .map((s) => ({ type: 'local' as const, path: s.path }))
}
