// Pure formatting / labeling helpers. Leaf module (docs/MAINTAINABILITY.md Phase 0):
// no JSX, no component imports — depends only on ./types. Extracted verbatim from
// App.tsx — behavior-preserving.
import type { AuthMode } from '../types'

export function methodLabel(mode: AuthMode): string {
  switch (mode) {
    case 'subscription':
      return 'Claude subscription · existing login'
    case 'oauth-token':
      return 'Claude subscription · setup-token'
    case 'api-key':
      return 'Anthropic API key'
  }
}

export function mcpStatusClass(status: string): string {
  if (status === 'connected') return 'ok'
  if (status === 'pending' || status === 'connecting') return 'pending'
  if (status === 'needs-auth') return 'warn'
  if (status === 'failed' || status === 'error') return 'err'
  return ''
}

export function fmtTokens(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)
}

export function usageShortLabel(label: string): string {
  const l = label.toLowerCase()
  if (l.startsWith('session')) return 'Session'
  if (l.includes('sonnet')) return 'Week · Sonnet'
  if (l.startsWith('week')) return 'Week'
  return label
}

export function toolIcon(name: string): string {
  switch (name) {
    case 'Bash':
      return '$_'
    case 'Read':
      return '≡'
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return '✎'
    case 'Glob':
    case 'Grep':
      return '⌕'
    case 'Task':
      return '◆'
    case 'Skill':
      return '🧩'
    case 'WebFetch':
    case 'WebSearch':
      return '∮'
    default:
      return '⛏'
  }
}

export function toolArgObj(input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>
  return String(
    o.skill ??
      o.command ??
      o.file_path ??
      o.path ??
      o.pattern ??
      o.url ??
      o.description ??
      o.subject ??
      o.status ??
      o.query ??
      o.name ??
      ''
  )
}

export function toolArg(inputRaw: string): string {
  try {
    return toolArgObj(JSON.parse(inputRaw))
  } catch {
    return ''
  }
}

export function ctxWindow(model: string): number {
  if (!model) return 1_000_000
  const m = model.toLowerCase()
  if (m.includes('[1m]')) return 1_000_000
  if (m.includes('haiku')) return 200_000
  if (m.includes('fable') || m.includes('mythos')) return 1_000_000
  if (m.includes('sonnet')) {
    // Sonnet 4.5 / 4.6 (and the bare `sonnet` alias) are 1M; older Sonnets 200k.
    return m === 'sonnet' || m.includes('sonnet-4-5') || m.includes('sonnet-4-6')
      ? 1_000_000
      : 200_000
  }
  if (m.includes('opus')) {
    // Opus 4.5/4.6/4.7/4.8 (and bare `opus`) are 1M; Opus 4.0/4.1 are 200k.
    return m.includes('opus-4-0') || m.includes('opus-4-1') ? 200_000 : 1_000_000
  }
  return 200_000
}

export function permArg(input: Record<string, unknown>): string {
  const o = input as Record<string, unknown>
  return String(o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? '')
}

/**
 * Prompt-cache hit rate as a percentage of total input tokens
 * (docs/TOKEN_OPTIMIZATION.md §3 lever 1 — cache read is 0.1× price, so a high
 * hit rate is the headline cost lever in API mode). Total input = fresh +
 * cache-read + cache-write. Returns null when there is no input to report.
 */
export function cacheHitPercent(fresh?: number, read?: number, write?: number): number | null {
  const f = fresh ?? 0
  const r = read ?? 0
  const w = write ?? 0
  const total = f + r + w
  if (total <= 0) return null
  return Math.round((r / total) * 100)
}
