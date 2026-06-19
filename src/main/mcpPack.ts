// Curated MCP server pack — one-click "recommended" local MCP servers for the
// EXTEND -> MCP console, mirroring skillsPack.ts. The flagship is **codegraph**
// (github.com/colbymchenry/codegraph, MIT): a 100%-local code-graph index that
// gives the agent call-graph navigation (caller/callee trails), incremental
// file-watch sync, and on-demand symbol queries — exactly the gaps in Forge's
// own regex repo map (which is structure-only, no call edges, rebuilt not synced).
//
// We do NOT port codegraph: it's a standalone MCP server, so the honest, zero-
// maintenance integration is to *register* it (write its config into the Forge-
// private forge-mcp.json via the existing saveMcpServer path). The user still
// installs the `codegraph` binary once + runs `codegraph init` per project; the
// UI surfaces both. Local-only is preserved: codegraph keeps a SQLite graph on
// disk and makes no network calls (no API keys), so BYO-key/local-only holds.

import { listMcpServers, saveMcpServer, type McpServerEntry } from './mcp'

export interface BundledMcpServer {
  /** Registry id + the installed server name (kept identical for idempotency). */
  name: string
  /** Human title for the card. */
  title: string
  /** What it does + why it complements Forge. */
  description: string
  homepage: string
  /** True when the server runs entirely on-device (no network egress). */
  localOnly: boolean
  /** The exact server config written on install. */
  entry: McpServerEntry
  /** One-time binary prerequisite, per platform (shown as a copy hint). */
  prerequisite?: { mac?: string; win?: string; npm?: string; note?: string }
  /** Honest, sourced headline metric — never invented. */
  metrics?: string
}

export interface BundledMcpStatus extends BundledMcpServer {
  installed: boolean
}

export type InstallBundledMcpResult =
  | { ok: true; servers: McpServerEntry[]; alreadyInstalled: boolean }
  | { ok: false; error: string }

export const MCP_PACK: BundledMcpServer[] = [
  {
    name: 'codegraph',
    title: 'CodeGraph — call-graph code intelligence',
    description:
      'A 100%-local code-graph index. Answers "who calls this?", "what does this call?", ' +
      'and "show this symbol + its caller/callee trail" in one tool call, and keeps the ' +
      'graph current via OS file-watch (FSEvents/inotify) incremental sync. Fills the gaps ' +
      "in Forge's structural repo map: real call edges and live sync, queried on demand " +
      'instead of injected up front. SQLite only — no API keys, no data leaves the machine.',
    homepage: 'https://github.com/colbymchenry/codegraph',
    localOnly: true,
    entry: {
      name: 'codegraph',
      transport: 'stdio',
      command: 'codegraph',
      args: ['serve', '--mcp']
    },
    prerequisite: {
      mac: 'curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh',
      win: 'irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex',
      npm: 'npm i -g @colbymchenry/codegraph',
      note: 'After installing the binary, run `codegraph init` once inside each project to build its .codegraph/ graph.'
    },
    metrics:
      'Author-reported median across 7 repos: 16% cheaper · 58% fewer tool calls · 47% fewer tokens.'
  }
]

/** The pack, each annotated with whether a server of that name is already registered. */
export async function listBundledMcpServers(): Promise<BundledMcpStatus[]> {
  let installed: McpServerEntry[]
  try {
    installed = await listMcpServers()
  } catch {
    installed = []
  }
  const have = new Set(installed.map((s) => s.name))
  return MCP_PACK.map((s) => ({ ...s, installed: have.has(s.name) }))
}

/**
 * Register one bundled MCP server into forge-mcp.json. Idempotent: if a server of
 * that name already exists, leave it untouched (never clobber a user edit) and
 * report alreadyInstalled. The binary prerequisite is the user's responsibility —
 * this only writes the connection config Forge passes to the SDK on each run.
 */
export async function installBundledMcpServer(name: string): Promise<InstallBundledMcpResult> {
  const bundled = MCP_PACK.find((s) => s.name === name)
  if (!bundled) return { ok: false, error: `Unknown bundled MCP server "${name}".` }
  const existing = await listMcpServers().catch(() => [] as McpServerEntry[])
  if (existing.some((s) => s.name === bundled.name)) {
    return { ok: true, servers: existing, alreadyInstalled: true }
  }
  const res = await saveMcpServer(bundled.entry)
  if (!res.ok) return res
  return { ok: true, servers: res.servers, alreadyInstalled: false }
}
