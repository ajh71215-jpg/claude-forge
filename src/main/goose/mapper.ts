// Translate goose ACP session/update notifications into a normalized Forge shape
// (docs/GOOSE_INTEGRATION.md §4) — port of Octopal's goose_acp_mapper.rs.
//
// Discriminator (verified live, goose 1.37.0): params.update.sessionUpdate. The
// payload field names for chunk/tool variants were documented by Octopal but not
// re-verified live here — keep this tolerant (read several likely keys).

import type { SessionUpdate } from './acpClient'

export type MappedEvent =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; tool: string; target?: string; status?: string }
  | { kind: 'usage'; used: number; size: number }
  | { kind: 'other'; sessionUpdate: string }

/**
 * goose Developer-extension tool name → Forge tool label.
 * Verified live (goose 1.37.0, 2026-06-16): the ACP surfaces decomposed tool
 * names (`write`/`edit`/`read`/`shell`/`tree`/`fetch`), NOT the `developer__*`
 * form Octopal documented. We accept both (live names + legacy prefixed) so the
 * mapper survives a goose version that switches back.
 */
export function normalizeTool(raw: string, command?: string): string {
  switch (raw) {
    // live goose 1.37.0 ACP tool names (_meta.goose.toolCall.toolName / title)
    case 'shell':
      return 'Bash'
    case 'write':
      return 'Write'
    case 'edit':
    case 'str_replace':
      return 'Edit'
    case 'read':
    case 'read_file':
    case 'view':
      return 'Read'
    case 'tree':
    case 'list':
      return 'List'
    case 'fetch':
      return 'WebFetch'
    case 'text_editor':
      return command === 'create' || command === 'write' ? 'Write' : 'Edit'
    // legacy `developer__*` form (Octopal-documented; kept for back-compat)
    case 'developer__shell':
      return 'Bash'
    case 'developer__text_editor':
      return command === 'create' || command === 'write' ? 'Write' : 'Edit'
    case 'developer__read_file':
      return 'Read'
    case 'developer__fetch':
      return 'WebFetch'
    default:
      return raw
  }
}

/**
 * Pull the clean goose tool name out of a tool_call/tool_call_update update.
 * Live shapes (1.37.0): the clean name is at `_meta.goose.toolCall.toolName`
 * ("write"), and `title` is decorated ("write · C:\path") — split off the
 * decoration. Falls back to the old `toolName` field if a future build adds it.
 */
function toolNameOf(u: SessionUpdate): string {
  const meta = (u._meta as Record<string, unknown> | undefined)?.goose as
    | { toolCall?: { toolName?: unknown } }
    | undefined
  const fromMeta = meta?.toolCall?.toolName
  if (typeof fromMeta === 'string' && fromMeta) return fromMeta
  const title = str(u.title)
  if (title) return title.split(' · ')[0].trim() // strip "name · target" decoration
  return str(u.toolName) ?? str(u.kind) ?? 'tool'
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

export function mapUpdate(u: SessionUpdate): MappedEvent {
  switch (u.sessionUpdate) {
    case 'agent_message_chunk':
      return { kind: 'text', text: chunkText(u) }
    case 'agent_thought_chunk':
      return { kind: 'thought', text: chunkText(u) }
    case 'usage_update':
      return {
        kind: 'usage',
        used: typeof u.used === 'number' ? u.used : 0,
        size: typeof u.size === 'number' ? u.size : 0
      }
    case 'tool_call':
    case 'tool_call_update': {
      const raw = toolNameOf(u)
      const input = (u.rawInput ?? u.input) as Record<string, unknown> | undefined
      return {
        kind: 'tool',
        tool: normalizeTool(raw, input ? str(input.command) : undefined),
        target: input ? str(input.path) ?? str(input.command) : undefined,
        status: str(u.status)
      }
    }
    default:
      return { kind: 'other', sessionUpdate: u.sessionUpdate }
  }
}

/** Extract the text of a *_chunk update across the likely shapes. */
function chunkText(u: SessionUpdate): string {
  const content = u.content as unknown
  if (typeof content === 'string') return content
  if (content && typeof content === 'object') {
    const c = content as Record<string, unknown>
    if (typeof c.text === 'string') return c.text
  }
  return str(u.text) ?? ''
}
