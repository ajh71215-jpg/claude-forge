// Pure aggregation helpers for the COST tab's visualizations. Leaf module (no
// JSX, no component imports) so the trend / per-conversation / budget logic is
// covered headlessly by `npm run test`. Behavior shared by CostView + CostChart.
import type { AgentActivity } from '../types'
import { cacheHitPercent } from './format'

/** A run carries a token/cache breakdown (the cost-bearing lead-agent entries).
 * Subagent/orchestration cards don't, so they're excluded from cost aggregation. */
export function hasTokens(a: AgentActivity): boolean {
  return a.inputTokens != null || a.outputTokens != null || a.cacheReadTokens != null
}

/** One point in the time-axis trend chart. */
export interface TrendPoint {
  /** Run end time (fallback start) — the chronological x. */
  t: number
  cost: number
  /** Prompt-cache hit % for this run (0 when there was no input). */
  cacheHit: number
  /** Total input+output tokens the run touched. */
  totalTokens: number
  label: string
}

/**
 * Chronological per-run series (oldest → newest), capped to the most recent
 * `cap` runs so the chart stays legible. Each run is one point; the x is real
 * run time so the series reads as a timeline of spend.
 */
export function trendSeries(entries: AgentActivity[], cap = 40): TrendPoint[] {
  const runs = entries.filter(hasTokens)
  runs.sort((a, b) => (a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt))
  return runs.slice(-cap).map((a) => {
    const totalIn = (a.inputTokens ?? 0) + (a.cacheReadTokens ?? 0) + (a.cacheWriteTokens ?? 0)
    return {
      t: a.endedAt ?? a.startedAt,
      cost: a.costUsd ?? 0,
      cacheHit: cacheHitPercent(a.inputTokens, a.cacheReadTokens, a.cacheWriteTokens) ?? 0,
      totalTokens: totalIn + (a.outputTokens ?? 0),
      label: a.detail ?? a.name
    }
  })
}

/** Per-conversation cost/token rollup. */
export interface ConvAgg {
  /** SDK session id, or '' for runs that predate session tagging. */
  sessionId: string
  cost: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  runs: number
  lastAt: number
  cacheHit: number
  /** input + cache-read + cache-write + output. */
  totalTokens: number
}

function emptyAgg(sessionId: string): ConvAgg {
  return {
    sessionId,
    cost: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    runs: 0,
    lastAt: 0,
    cacheHit: 0,
    totalTokens: 0
  }
}

/**
 * Group cost-bearing runs by conversation (sessionId), so the dashboard can show
 * which conversation is eating the budget. Runs with no sessionId fold into one
 * '' bucket (nothing is silently dropped). Sorted by cost, biggest spender first.
 */
export function byConversation(entries: AgentActivity[]): ConvAgg[] {
  const map = new Map<string, ConvAgg>()
  for (const a of entries) {
    if (!hasTokens(a)) continue
    const key = a.sessionId ?? ''
    const c = map.get(key) ?? emptyAgg(key)
    c.cost += a.costUsd ?? 0
    c.input += a.inputTokens ?? 0
    c.output += a.outputTokens ?? 0
    c.cacheRead += a.cacheReadTokens ?? 0
    c.cacheWrite += a.cacheWriteTokens ?? 0
    c.runs += 1
    c.lastAt = Math.max(c.lastAt, a.endedAt ?? a.startedAt)
    map.set(key, c)
  }
  const out = [...map.values()]
  for (const c of out) {
    c.cacheHit = cacheHitPercent(c.input, c.cacheRead, c.cacheWrite) ?? 0
    c.totalTokens = c.input + c.cacheRead + c.cacheWrite + c.output
  }
  out.sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens)
  return out
}

/** The highest budget threshold crossed by `spent` against `budget` (0/80/100).
 * 0 budget means "no budget set" → never crosses. */
export function budgetLevel(spent: number, budget: number): 0 | 80 | 100 {
  if (budget <= 0) return 0
  const pct = (spent / budget) * 100
  if (pct >= 100) return 100
  if (pct >= 80) return 80
  return 0
}
