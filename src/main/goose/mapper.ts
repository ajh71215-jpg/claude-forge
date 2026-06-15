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

/** goose Developer-extension tool name → Forge tool label. */
export function normalizeTool(raw: string, command?: string): string {
  switch (raw) {
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
      const raw = str(u.title) ?? str(u.toolName) ?? str(u.kind) ?? 'tool'
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
