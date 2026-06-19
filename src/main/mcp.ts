import { readForgeConfig, writeForgeConfig } from './projectSettings'
import { scopeMcpServers } from './mcpScope'

/**
 * MCP server management (roadmap #4). Forge owns the connections, so servers are
 * persisted to a Forge-private `forge-mcp.json` and passed to the SDK via the
 * `mcpServers` option (in agent.ts) rather than written into `.claude/`. This
 * keeps secrets (headers/env) out of the project config the model can read, and
 * sidesteps the `.mcp.json` vs settings.json discovery nuances.
 */

export type McpTransport = 'stdio' | 'http' | 'sse'

export interface McpServerEntry {
  name: string
  transport: McpTransport
  /** stdio */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** http | sse */
  url?: string
  headers?: Record<string, string>
}

export interface McpSaveInput extends McpServerEntry {
  /** Previous name when editing+renaming. */
  originalName?: string
}

export type McpSaveResult =
  | { ok: true; servers: McpServerEntry[] }
  | { ok: false; error: string }

const FILE = 'forge-mcp.json'
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

async function readAll(): Promise<McpServerEntry[]> {
  const cfg = await readForgeConfig<{ servers?: McpServerEntry[] }>(FILE, { servers: [] })
  return Array.isArray(cfg.servers) ? cfg.servers : []
}
async function writeAll(servers: McpServerEntry[]): Promise<void> {
  await writeForgeConfig(FILE, { servers })
}

export async function listMcpServers(): Promise<McpServerEntry[]> {
  return (await readAll()).sort((a, b) => a.name.localeCompare(b.name))
}

/** Normalize an inbound entry, dropping empty fields per transport. */
function clean(input: McpServerEntry): McpServerEntry {
  const e: McpServerEntry = { name: input.name.trim(), transport: input.transport }
  if (input.transport === 'stdio') {
    e.command = (input.command ?? '').trim()
    const args = (input.args ?? []).map((a) => a.trim()).filter(Boolean)
    if (args.length) e.args = args
    const env = cleanRecord(input.env)
    if (env) e.env = env
  } else {
    e.url = (input.url ?? '').trim()
    const headers = cleanRecord(input.headers)
    if (headers) e.headers = headers
  }
  return e
}
function cleanRecord(r?: Record<string, string>): Record<string, string> | undefined {
  if (!r) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(r)) if (k.trim()) out[k.trim()] = v
  return Object.keys(out).length ? out : undefined
}

export async function saveMcpServer(input: McpSaveInput): Promise<McpSaveResult> {
  const name = (input.name || '').trim()
  if (!NAME_RE.test(name)) {
    return { ok: false, error: 'Name must be 1–64 chars: letters, digits, _ or -.' }
  }
  if (input.transport === 'stdio') {
    if (!(input.command ?? '').trim()) return { ok: false, error: 'stdio servers need a command.' }
  } else {
    const url = (input.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'http/sse servers need an http(s) URL.' }
  }
  const orig = input.originalName?.trim()
  const servers = await readAll()
  const idx = orig ? servers.findIndex((s) => s.name === orig) : -1
  // Guard against name collisions (new name already used by a different entry).
  if (servers.some((s) => s.name === name && s.name !== orig)) {
    return { ok: false, error: `A server named "${name}" already exists.` }
  }
  const entry = clean(input)
  if (idx >= 0) servers[idx] = entry
  else servers.push(entry)
  await writeAll(servers)
  return { ok: true, servers: await listMcpServers() }
}

export async function deleteMcpServer(name: string): Promise<McpServerEntry[]> {
  const servers = (await readAll()).filter((s) => s.name !== name)
  await writeAll(servers)
  return listMcpServers()
}

/**
 * Convert stored entries to the SDK `mcpServers` option shape. `scope` (the
 * per-conversation MCP scope) restricts which servers load this run; undefined ⇒
 * all (default), `[]` ⇒ none. Trims the per-turn "MCP tax" (TOKEN_OPTIMIZATION §10).
 */
export async function toSdkMcpServers(
  scope?: string[]
): Promise<Record<string, Record<string, unknown>>> {
  const servers = scopeMcpServers(await readAll(), scope)
  const out: Record<string, Record<string, unknown>> = {}
  for (const s of servers) {
    if (!s?.name) continue
    if (s.transport === 'stdio') {
      if (!s.command) continue
      out[s.name] = { command: s.command, ...(s.args ? { args: s.args } : {}), ...(s.env ? { env: s.env } : {}) }
    } else if (s.transport === 'http') {
      if (!s.url) continue
      out[s.name] = { type: 'http', url: s.url, ...(s.headers ? { headers: s.headers } : {}) }
    } else if (s.transport === 'sse') {
      if (!s.url) continue
      out[s.name] = { type: 'sse', url: s.url, ...(s.headers ? { headers: s.headers } : {}) }
    }
  }
  return out
}
