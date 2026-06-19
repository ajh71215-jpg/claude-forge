// In-process MCP server exposing memory's progressive disclosure (claude-mem
// absorption) as three tools the model can drive on demand:
//   memory_search   → compact index (cheap; scan many, commit to few)
//   memory_timeline → chronological neighbors of chosen ids (context)
//   memory_get      → full records for a filtered id set (the only expensive call)
//
// This is the thin SDK/store glue over the pure disclose.ts core. Registered in
// runStreaming ONLY when the user opts in (memory.toolsEnabled), so the default
// token-frugal path pays no extra tool tax. Best-effort: any failure returns an
// isError result so the model can fall back to its other recall paths.

import { z } from 'zod'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { capToolResult } from '../efficiency/compress'
import { allMemories, recordAccess } from './store'
import { searchIndex, timeline, getRecords } from './disclose'
import type { MemoryKind } from './types'

const DAY = 86_400_000
const KINDS = ['working', 'episodic', 'semantic', 'procedural'] as const

function ok(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}
function err(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true as const }
}

/**
 * Build the memory disclosure MCP server, scoped to a conversation's workspace
 * so search results don't leak across isolated workspaces.
 */
export function buildMemoryServer(workspaceId?: string) {
  const search = tool(
    'memory_search',
    'Search persistent project memory (facts auto-captured from earlier sessions). ' +
      'Returns a COMPACT index — id, kind, and a short snippet only — so you can scan ' +
      'many results cheaply. Then pass the ids you care about to memory_get for the ' +
      'full text (do NOT assume the snippet is complete). Use this before re-deriving ' +
      'something the project may have already established.',
    {
      query: z.string().describe('Keywords to match (BM25 over fact text + tags). Empty = most recent.'),
      limit: z.number().int().positive().optional().describe('Max rows (default 10).'),
      kind: z.enum(KINDS).optional().describe('Restrict to one memory kind.'),
      sinceDays: z.number().positive().optional().describe('Only facts from the last N days.')
    },
    async (args) => {
      try {
        const entries = await allMemories()
        const rows = searchIndex(entries, args.query ?? '', {
          limit: args.limit,
          kind: args.kind as MemoryKind | undefined,
          sinceMs: args.sinceDays != null ? Date.now() - args.sinceDays * DAY : undefined,
          workspaceId
        })
        if (rows.length === 0) return ok({ rows: [], note: 'No matching memories.' })
        return ok({ rows, next: 'Call memory_get with the ids you want in full.' })
      } catch (e) {
        return err(`memory_search failed: ${String(e).slice(0, 160)}`)
      }
    }
  )

  const timelineTool = tool(
    'memory_timeline',
    'Show the chronological NEIGHBORS of one or more memory ids — what was captured ' +
      'around the same time — to judge relevance before fetching full detail. Returns ' +
      'compact rows with deltaMs from the earliest anchor.',
    {
      ids: z.array(z.string()).min(1).describe('Anchor memory ids (from memory_search).'),
      windowMinutes: z.number().positive().optional().describe('Half-window around each anchor (default 60).'),
      limit: z.number().int().positive().optional().describe('Max rows (default 12).'),
      sameSession: z.boolean().optional().describe('Restrict to the anchors’ own session(s).')
    },
    async (args) => {
      try {
        const entries = await allMemories()
        const rows = timeline(entries, args.ids, {
          windowMs: args.windowMinutes != null ? args.windowMinutes * 60_000 : undefined,
          limit: args.limit,
          sameSession: args.sameSession
        })
        return ok({ rows })
      } catch (e) {
        return err(`memory_timeline failed: ${String(e).slice(0, 160)}`)
      }
    }
  )

  const get = tool(
    'memory_get',
    'Fetch the FULL text of specific memories by id (from memory_search/memory_timeline). ' +
      'This is the only call that returns complete records, so request only the ids you ' +
      'have already qualified as relevant.',
    {
      ids: z.array(z.string()).min(1).describe('Memory ids to expand in full.')
    },
    async (args) => {
      try {
        const entries = await allMemories()
        const records = getRecords(entries, args.ids)
        // Strengthen what was actually pulled in full (usage reinforcement).
        await recordAccess(records.map((r) => r.id))
        const text = capToolResult(JSON.stringify({ records }), undefined, 'memory records').text
        return { content: [{ type: 'text' as const, text }] }
      } catch (e) {
        return err(`memory_get failed: ${String(e).slice(0, 160)}`)
      }
    }
  )

  return createSdkMcpServer({ name: 'memory', version: '1.0.0', tools: [search, timelineTool, get] })
}
