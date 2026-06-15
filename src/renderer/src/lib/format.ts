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
      return '❖'
    case 'WebFetch':
    case 'WebSearch':
      return '∮'
    default:
      return '◇'
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

/** One rendered diff row: added (green), removed (red), or unchanged context. */
export interface DiffLine {
  type: 'add' | 'del' | 'ctx'
  text: string
}

/**
 * Line-level diff via classic LCS so only the lines that actually changed are
 * marked add/del and shared lines stay as neutral context. Used to visualize
 * Edit/Write/NotebookEdit tool inputs in the transcript.
 */
function lineDiff(oldStr: string, newStr: string): DiffLine[] {
  const a = oldStr.split('\n')
  const b = newStr.split('\n')
  const n = a.length
  const m = b.length
  // dp[i][j] = LCS length of a[i:] and b[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

/**
 * Build a diff view from a tool-call's raw input. Edit/NotebookEdit diff the
 * old vs new string; Write shows the whole new file as additions. Returns null
 * for tools that aren't file edits (so the generic tool card renders instead).
 */
export function toolDiff(name: string, inputRaw: string): DiffLine[] | null {
  if (name !== 'Edit' && name !== 'Write' && name !== 'NotebookEdit') return null
  try {
    const o = JSON.parse(inputRaw) as Record<string, unknown>
    if (name === 'Write') {
      const content = String(o.content ?? '')
      if (!content) return null
      return content.split('\n').map((text) => ({ type: 'add' as const, text }))
    }
    const oldS = String(o.old_string ?? o.old_source ?? '')
    const newS = String(o.new_string ?? o.new_source ?? '')
    if (!oldS && !newS) return null
    return lineDiff(oldS, newS)
  } catch {
    return null
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

/**
 * Per-model default for the LIMITS "max turns" cap. Bigger-context models can
 * sustain longer agent loops before compaction bites, so they get a higher
 * default; small-window models (200k) stay conservative to avoid runaway loops
 * that blow the window before auto-compact (80%) can trigger.
 *
 *   1M window  → 40 turns   (sonnet-4.5/4.6, opus-4.5+, fable, [1m] tiers)
 *   200k + haiku (cheap/fast, safe to iterate) → 30 turns
 *   200k other → 20 turns   (legacy default, conservative)
 */
export function defaultMaxTurns(model: string): number {
  const win = ctxWindow(model)
  if (win >= 1_000_000) return 40
  if (model.toLowerCase().includes('haiku')) return 30
  return 20
}

/** Effective max turns for a model: user override if set, else per-model default. */
export function resolveMaxTurns(byModel: Record<string, number>, model: string): number {
  const v = byModel[model]
  return typeof v === 'number' && v > 0 ? v : defaultMaxTurns(model)
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
