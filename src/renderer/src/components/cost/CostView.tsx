// COST / CACHE dashboard. The token/cache-hit/per-run cost data was already
// captured in the main process (the SDK `result` message → AgentActivity), but
// only `costUsd` survived to history and nothing surfaced the token/cache split.
// agentActivity.ts now persists the full breakdown; this tab aggregates it.
//
// Pure observatory: reads window.forge.activity (same feed as the Agents tab) —
// NO model calls, NO extra tokens. Live runs update in place, history persists.
// Visualizations: a time-axis cost trend (cost bars + cache-hit line), a
// per-conversation comparison (which chat eats the budget), a per-run table, and
// a spend budget with an 80% / 100% toast warning.
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { AgentActivity, ActivitySnapshot, SessionInfo } from '../../types'
import { cacheHitPercent, fmtTokens } from '../../lib/format'
import { loadJson, saveJson } from '../../lib/storage'
import { trendSeries, byConversation, budgetLevel, type ConvAgg } from '../../lib/cost'
import CostChart from './CostChart'

function fmtCost(n: number): string {
  if (n <= 0) return '$0'
  if (n < 0.01) return '$' + n.toFixed(4)
  if (n < 1) return '$' + n.toFixed(3)
  return '$' + n.toFixed(2)
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`
}

function relTime(ts: number, now: number): string {
  const d = Math.max(0, now - ts)
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}

interface Totals {
  cost: number
  runs: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  injected: number
}

function aggregate(entries: AgentActivity[]): Totals {
  const t: Totals = {
    cost: 0,
    runs: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    injected: 0
  }
  for (const a of entries) {
    if (typeof a.costUsd === 'number') t.cost += a.costUsd
    // Token/cache breakdown lives on `run` entries (lead agent of each turn).
    const hasTokens =
      a.inputTokens != null || a.outputTokens != null || a.cacheReadTokens != null
    if (hasTokens) {
      t.runs += 1
      t.input += a.inputTokens ?? 0
      t.output += a.outputTokens ?? 0
      t.cacheRead += a.cacheReadTokens ?? 0
      t.cacheWrite += a.cacheWriteTokens ?? 0
      t.injected += a.injectedTokens ?? 0
    }
  }
  return t
}

/** One stat tile in the summary grid. */
function Stat({
  label,
  value,
  sub,
  hot
}: {
  label: string
  value: string
  sub?: string
  hot?: boolean
}): JSX.Element {
  return (
    <div className={`cost-stat${hot ? ' hot' : ''}`}>
      <div className="cost-stat-label">{label}</div>
      <div className="cost-stat-value">{value}</div>
      {sub && <div className="cost-stat-sub">{sub}</div>}
    </div>
  )
}

interface Toast {
  id: number
  level: 80 | 100
  msg: string
}

export default function CostView(): JSX.Element {
  const [live, setLive] = useState<AgentActivity[]>([])
  const [history, setHistory] = useState<AgentActivity[]>([])
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [now, setNow] = useState(Date.now())
  // Spend budget (USD) the user sets for cumulative recorded cost; 0 = off. Toasts
  // at 80% / 100%. Persisted so the alert threshold survives a restart.
  const [budget, setBudget] = useState<number>(() => loadJson('forge-cost-budget', 0))
  const [toasts, setToasts] = useState<Toast[]>([])
  // Highest threshold already announced this session, so a toast fires once on the
  // upward crossing rather than on every activity tick. Seeded silently on mount.
  const notifiedRef = useRef<0 | 80 | 100>(0)
  const seededRef = useRef(false)

  useEffect(() => saveJson('forge-cost-budget', budget), [budget])

  useEffect(() => {
    let active = true
    window.forge.activity
      .snapshot()
      .then((s: ActivitySnapshot) => {
        if (!active) return
        setLive(s.live)
        setHistory(s.history)
      })
      .catch(() => {})
    window.forge.agent
      .sessions()
      .then((s: SessionInfo[]) => active && setSessions(s))
      .catch(() => {})
    const unsub = window.forge.activity.onUpdate((s: ActivitySnapshot) => {
      setLive(s.live)
      setHistory(s.history)
    })
    return () => {
      active = false
      unsub()
    }
  }, [])

  // Advance elapsed/relative clocks. History rows show "X ago" (relTime uses
  // `now`), so keep ticking whenever any row is shown — not just while live —
  // else those labels freeze.
  useEffect(() => {
    if (live.length === 0 && history.length === 0) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [live.length, history.length])

  const all = useMemo(() => [...live, ...history], [live, history])
  const totals = useMemo(() => aggregate(all), [all])
  const cacheHit = cacheHitPercent(totals.input, totals.cacheRead, totals.cacheWrite) ?? 0
  const totalInput = totals.input + totals.cacheRead + totals.cacheWrite
  const trend = useMemo(() => trendSeries(all), [all])
  const convs = useMemo(() => byConversation(all), [all])

  // Budget alerting: fire a toast when cumulative cost crosses 80% / 100% upward.
  useEffect(() => {
    const level = budgetLevel(totals.cost, budget)
    if (!seededRef.current) {
      // First evaluation after mount: adopt the current level without alerting,
      // so reopening the app already-over-budget doesn't spam a stale toast.
      seededRef.current = true
      notifiedRef.current = level
      return
    }
    if (level > notifiedRef.current) {
      const pct = Math.round((totals.cost / budget) * 100)
      const msg =
        level === 100
          ? `Budget reached — ${fmtCost(totals.cost)} of ${fmtCost(budget)} (${pct}%).`
          : `${pct}% of your ${fmtCost(budget)} budget used (${fmtCost(totals.cost)}).`
      const id = Date.now()
      setToasts((t) => [...t, { id, level: level as 80 | 100, msg }])
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 8000)
    }
    // On a downward move (budget raised, history cleared) lower the watermark so a
    // later re-crossing alerts again.
    if (level < notifiedRef.current) notifiedRef.current = level
    else notifiedRef.current = Math.max(notifiedRef.current, level) as 0 | 80 | 100
  }, [totals.cost, budget])

  // Per-run rows: only entries that carry a token breakdown, newest first.
  const runRows = useMemo(
    () =>
      all
        .filter(
          (a) => a.inputTokens != null || a.outputTokens != null || a.cacheReadTokens != null
        )
        .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
        .slice(0, 100),
    [all]
  )

  function convLabel(sid: string): string {
    if (!sid) return 'Older / untracked runs'
    return sessions.find((s) => s.sessionId === sid)?.title ?? `Chat ${sid.slice(0, 6)}`
  }

  async function clear(): Promise<void> {
    const s = await window.forge.activity.clear()
    setLive(s.live)
    setHistory(s.history)
  }

  const budgetPct = budget > 0 ? (totals.cost / budget) * 100 : 0
  const budgetLvl = budgetLevel(totals.cost, budget)
  const maxConvCost = Math.max(...convs.map((c) => c.cost), 0.0001)

  return (
    <div className="cost-root">
      <div className="cost-bar">
        <div className="cost-bar-title">
          <span className="cost-bar-mark">⛁</span> Cost &amp; Cache
        </div>
        <div className="cost-bar-meta">
          <span className="cost-bar-sub">across {totals.runs} recorded runs</span>
          {history.length > 0 && (
            <button className="ad-clear" onClick={clear} title="Clear recorded run history">
              clear history
            </button>
          )}
        </div>
      </div>

      <div className="cost-scroll">
        <div className="cost-grid">
          <Stat label="TOTAL COST" value={fmtCost(totals.cost)} sub={`${totals.runs} runs`} />
          <Stat
            label="CACHE HIT"
            value={`${cacheHit}%`}
            sub={`${fmtTokens(totals.cacheRead)} cached of ${fmtTokens(totalInput)} in`}
            hot={cacheHit >= 50}
          />
          <Stat label="INPUT TOKENS" value={fmtTokens(totals.input)} sub="fresh (uncached)" />
          <Stat label="OUTPUT TOKENS" value={fmtTokens(totals.output)} sub="generated" />
          <Stat label="CACHE READ" value={fmtTokens(totals.cacheRead)} sub="billed at ~0.1×" />
          <Stat label="CACHE WRITE" value={fmtTokens(totals.cacheWrite)} sub="cache creation" />
          <Stat
            label="INJECTED CTX"
            value={fmtTokens(totals.injected)}
            sub="Forge: repo map + memory"
          />
        </div>

        {/* ---- spend budget ---- */}
        <div className={`cost-budget lvl-${budgetLvl}`}>
          <div className="cost-budget-head">
            <span className="cost-budget-title">Spend budget</span>
            <label className="cost-budget-input">
              $
              <input
                type="number"
                min={0}
                step="1"
                aria-label="Spend budget in US dollars (0 to disable)"
                value={budget || ''}
                placeholder="off"
                onChange={(e) => setBudget(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          </div>
          {budget > 0 ? (
            <>
              <div className="cost-budget-bar">
                <div
                  className="cost-budget-fill"
                  style={{ width: Math.min(100, budgetPct) + '%' }}
                />
              </div>
              <div className="cost-budget-foot">
                <span>
                  {fmtCost(totals.cost)} of {fmtCost(budget)}
                </span>
                <span className="cost-budget-pct">{Math.round(budgetPct)}%</span>
                <span>
                  {budgetLvl === 100
                    ? `over by ${fmtCost(totals.cost - budget)}`
                    : `${fmtCost(Math.max(0, budget - totals.cost))} left`}
                </span>
              </div>
            </>
          ) : (
            <div className="cost-budget-hint">
              Set a budget to track cumulative spend and get an alert at 80% and 100%.
            </div>
          )}
        </div>

        <div className="cost-cachebar-wrap">
          <div className="cost-cachebar-top">
            <span>Prompt-cache reuse</span>
            <span className="cost-cachebar-pct">{cacheHit}%</span>
          </div>
          <div className="cost-cachebar">
            <div className="cost-cachebar-fill" style={{ width: cacheHit + '%' }} />
          </div>
          <div className="cost-cachebar-legend">
            Higher is cheaper — cache reads cost ~10% of fresh input tokens
            (docs/TOKEN_OPTIMIZATION.md §3 lever 1).
          </div>
        </div>

        {/* ---- time-axis trend ---- */}
        {trend.length >= 2 && (
          <>
            <div className="cost-section-head">
              <span className="cost-section-title">Spend over time</span>
              <span className="cost-section-sub">last {trend.length} runs</span>
            </div>
            <div className="cost-panel">
              <CostChart points={trend} />
            </div>
          </>
        )}

        {/* ---- per-conversation comparison ---- */}
        {convs.length > 0 && (
          <>
            <div className="cost-section-head">
              <span className="cost-section-title">By conversation</span>
              <span className="cost-section-sub">{convs.length} tracked</span>
            </div>
            <div className="cost-conv">
              {convs.slice(0, 8).map((c: ConvAgg) => (
                <div className="cost-conv-row" key={c.sessionId || 'untracked'}>
                  <div className="cost-conv-top">
                    <span className="cost-conv-label" title={convLabel(c.sessionId)}>
                      {convLabel(c.sessionId)}
                    </span>
                    <span className="cost-conv-cost">{fmtCost(c.cost)}</span>
                  </div>
                  <div className="cost-conv-bar">
                    <div
                      className="cost-conv-fill"
                      style={{ width: Math.max(2, (c.cost / maxConvCost) * 100) + '%' }}
                    />
                  </div>
                  <div className="cost-conv-meta">
                    <span>{fmtTokens(c.totalTokens)} tokens</span>
                    <span className={c.cacheHit >= 50 ? 'good' : ''}>{c.cacheHit}% cache</span>
                    <span>
                      {c.runs} run{c.runs === 1 ? '' : 's'}
                    </span>
                    <span className="cost-conv-when">{relTime(c.lastAt, now)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="cost-section-head">
          <span className="cost-section-title">Per-run breakdown</span>
          <span className="cost-section-sub">{runRows.length} runs</span>
        </div>

        {runRows.length === 0 ? (
          <div className="cost-empty">
            <div className="cost-empty-mark">⛁</div>
            <div className="cost-empty-title">No runs recorded yet</div>
            <div className="cost-empty-text">
              Token, cache-hit and cost figures appear here automatically after each chat run —
              no extra tokens, captured from the SDK result you already paid for.
            </div>
          </div>
        ) : (
          <div className="cost-table">
            <div className="cost-thead">
              <span className="ct-name">run</span>
              <span className="ct-num">in</span>
              <span className="ct-num">out</span>
              <span className="ct-num">cache</span>
              <span className="ct-num">cost</span>
              <span className="ct-num">dur</span>
              <span className="ct-num">when</span>
            </div>
            {runRows.map((a) => {
              const hit =
                cacheHitPercent(a.inputTokens, a.cacheReadTokens, a.cacheWriteTokens) ?? 0
              const dur = a.endedAt ? a.endedAt - a.startedAt : 0
              const running = a.status === 'running'
              return (
                <div
                  className={`cost-trow${running ? ' running' : ''}`}
                  key={`${a.id}-${a.startedAt}`}
                >
                  <span className="ct-name" title={a.detail ?? a.name}>
                    {running && <span className="ct-dot" />}
                    {a.detail ?? a.name}
                  </span>
                  <span className="ct-num">{fmtTokens(a.inputTokens ?? 0)}</span>
                  <span className="ct-num">{fmtTokens(a.outputTokens ?? 0)}</span>
                  <span className={`ct-num ${hit >= 50 ? 'good' : ''}`}>{hit}%</span>
                  <span className="ct-num cost">
                    {typeof a.costUsd === 'number' ? fmtCost(a.costUsd) : '—'}
                  </span>
                  <span className="ct-num">{dur ? fmtDuration(dur) : '—'}</span>
                  <span className="ct-num when">{relTime(a.endedAt ?? a.startedAt, now)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Budget toasts — portaled to <body> so they surface over any tab (CostView
          stays mounted but hidden behind a display:none pane). */}
      {toasts.length > 0 &&
        createPortal(
          <div className="forge-toasts">
            {toasts.map((t) => (
              <div className={`forge-toast lvl-${t.level}`} key={t.id} role="alert">
                <span className="forge-toast-mark">{t.level === 100 ? '⚠' : '◔'}</span>
                <span className="forge-toast-msg">{t.msg}</span>
                <button
                  className="forge-toast-x"
                  aria-label="Dismiss"
                  onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
