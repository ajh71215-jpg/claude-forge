// Pure helpers extracted from Composer.tsx (no React/DOM) so the component file
// stays focused on state + JSX.
import type { Turn } from '../types'
import { toolArg, toolIcon } from './format'

/** Plain-language description of what the agent is doing right now, derived from
 * the active turn's latest block — so the pinned live strip says e.g. "Read
 * src/main/agent.ts" or "thinking…" instead of an opaque "running". */
export function activityLabel(turn: Turn | null): { icon: string; text: string } {
  const b = turn?.blocks[turn.blocks.length - 1]
  if (!b) return { icon: '✦', text: 'thinking…' }
  if (b.kind === 'thinking') return { icon: '✦', text: 'thinking…' }
  if (b.kind === 'text') return { icon: '✎', text: 'writing response…' }
  if (b.status === 'running') {
    const arg = toolArg(b.inputRaw)
    return { icon: toolIcon(b.name), text: arg ? `${b.name} ${arg}` : `${b.name}…` }
  }
  return { icon: '⚒', text: 'working…' }
}

/** Flatten a turn's searchable text (prompt + every block) for transcript search. */
export function turnText(t: Turn): string {
  const parts = [t.prompt]
  for (const b of t.blocks) {
    if (b.kind === 'text' || b.kind === 'thinking') parts.push(b.text)
    else if (b.kind === 'tool') parts.push(b.name, b.inputRaw, b.result ?? '')
  }
  return parts.join(' ').toLowerCase()
}

/** Interactive-only CLI commands with no headless behavior — surfaced with a clear
 * note instead of being silently forwarded to the SDK (where they no-op). */
export const INTERACTIVE_ONLY = new Set([
  'login',
  'logout',
  'agents',
  'ide',
  'bug',
  'vim',
  'terminal-setup',
  'install-github-app'
])
