// Squad tab = AGENT ACTIVITY DASHBOARD (redesign). The old manual plan editor was
// removed: orchestration modes (live / ralph / loop) now run when requested from
// chat or chosen by the model itself, and this tab is a read-only observatory of
// what agents are doing and which agents you've used.
//
// Data comes from the MAIN-process activity store (src/main/agentActivity.ts),
// which taps the agent event bus so it captures every run / Task subagent /
// orchestration subtask regardless of the focused tab, and persists history to a
// Forge-private json. We pull a snapshot on mount and subscribe to live updates.
//
// The "Inspect" button on live 'run' cards opens RunDebugView, which shows the
// full thinking content + tool input/output JSON from the useDebugStream store.
import { useEffect, useState, type JSX } from 'react'
import Icon from '../Icon'
import type { AgentActivity, ActivitySnapshot, ToolEvent } from '../../types'
import type { DebugRun } from '../../lib/useDebugStream'
import RunDebugView from './RunDebugView'

const KIND_LABEL: Record<AgentActivity['kind'], string> = {
  run: 'main',
  task: 'subagent',
  orchestration: 'orchestrated'
}
const KIND_ICON: Record<AgentActivity['kind'], string> = {
  run: '⚒',
  task: '◆',
  orchestration: '⇉'
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

/** Expandable list of the tools an agent used (Read/Bash/Write/…). */
function ToolList({ tools }: { tools: ToolEvent[] }): JSX.Element {
  return (
    <div className="ad-tools">
      {tools.map((t, i) => (
        <div className={`ad-tool ${t.status}`} key={t.id + i}>
          <span className={`ad-tool-dot ${t.status}`} />
          <span className="ad-tool-name">{t.name}</span>
          {t.arg && <span className="ad-tool-arg">{t.arg}</span>}
          {t.endedAt && (
            <span className="ad-tool-dur">{fmtDuration(t.endedAt - t.startedAt)}</span>
          )}
        </div>
      ))}
    </div>
  )
}

interface SquadViewProps {
  debugRuns: Map<string, DebugRun>
}

export default function SquadView({ debugRuns }: SquadViewProps): JSX.Element {
  const [live, setLive] = useState<AgentActivity[]>([])
  const [history, setHistory] = useState<AgentActivity[]>([])
  const [now, setNow] = useState(Date.now())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  /** runId being inspected in RunDebugView; null = show the normal card list. */
  const [inspectId, setInspectId] = useState<string | null>(null)

  const toggle = (key: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // Initial snapshot + live subscription.
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
    const unsub = window.forge.activity.onUpdate((s: ActivitySnapshot) => {
      setLive(s.live)
      setHistory(s.history)
    })
    return () => {
      active = false
      unsub()
    }
  }, [])

  // Tick once a second to advance elapsed/relative clocks. History rows show
  // "X ago" (relTime uses `now`), so keep ticking whenever any row is shown —
  // not just while something is live, else those labels freeze.
  useEffect(() => {
    if (live.length === 0 && history.length === 0) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [live.length, history.length])

  async function clearHistory(): Promise<void> {
    const s = await window.forge.activity.clear()
    setLive(s.live)
    setHistory(s.history)
  }

  // When RunDebugView is open, render it instead of the normal card list.
  if (inspectId !== null) {
    return (
      <div className="ad-root">
        <RunDebugView
          run={debugRuns.get(inspectId) ?? null}
          onClose={() => setInspectId(null)}
        />
      </div>
    )
  }

  return (
    <div className="ad-root">
      <div className="ad-bar">
        <div className="ad-bar-title">
          <span className="ad-bar-mark">⚒</span> Agent Activity
        </div>
        <div className="ad-bar-meta">
          {live.length > 0 ? (
            <span className="ad-live-count">
              <span className="ad-live-dot" /> {live.length} active
            </span>
          ) : (
            <span className="ad-idle">idle</span>
          )}
          {history.length > 0 && (
            <button className="ad-clear" onClick={clearHistory} title="Clear agent history">
              clear history
            </button>
          )}
        </div>
      </div>

      <div className="ad-scroll">
        {/* LIVE */}
        <section className="ad-section">
          <div className="ad-section-head">
            <span className="ad-section-title">Live</span>
            <span className="ad-section-sub">running now</span>
          </div>
          {live.length === 0 ? (
            <div className="ad-empty">
              <div className="ad-empty-mark">⚒</div>
              <div className="ad-empty-title">No agents running</div>
              <div className="ad-empty-text">
                Agents appear here automatically when the assistant delegates work (Task
                subagents) or runs an orchestration mode (live / ralph / loop), triggered from
                chat or by the model itself.
              </div>
            </div>
          ) : (
            <div className="ad-cards">
              {live.map((a) => {
                const hasTools = !!a.tools && a.tools.length > 0
                const open = expanded.has(a.id)
                return (
                  <div className={`ad-card ${a.kind}`} key={a.id}>
                    <div
                      className={`ad-card-row${hasTools ? ' clickable' : ''}`}
                      onClick={hasTools ? () => toggle(a.id) : undefined}
                    >
                      <span className="ad-spinner" aria-hidden />
                      <span className="ad-kind">
                        {KIND_ICON[a.kind]} {KIND_LABEL[a.kind]}
                      </span>
                      <span className="ad-name">{a.name}</span>
                      {a.detail && <span className="ad-detail">{a.detail}</span>}
                      {(a.tokens || a.toolUses) && (
                        <span className="ad-usage" title="Subagent usage so far">
                          {a.toolUses ? `${a.toolUses} tools` : ''}
                          {a.tokens ? ` · ${(a.tokens / 1000).toFixed(1)}k tok` : ''}
                        </span>
                      )}
                      {hasTools && (
                        <span className="ad-toolcount">
                          {a.tools!.length} {open ? '▾' : '▸'}
                        </span>
                      )}
                      <span className="ad-elapsed">{fmtDuration(now - a.startedAt)}</span>
                      {/* Inspect button: only for 'run' cards (keyed by runId in debugRuns) */}
                      {a.kind === 'run' && (
                        <button
                          className="ad-inspect-btn"
                          title="Inspect: full thinking + tool I/O"
                          aria-label="Inspect run"
                          onClick={(e) => { e.stopPropagation(); setInspectId(a.id) }}
                        >
                          <Icon name="inspect" /> inspect
                        </button>
                      )}
                    </div>
                    {open && hasTools && <ToolList tools={a.tools!} />}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* HISTORY */}
        <section className="ad-section">
          <div className="ad-section-head">
            <span className="ad-section-title">History</span>
            <span className="ad-section-sub">{history.length} agents used</span>
          </div>
          {history.length === 0 ? (
            <div className="ad-empty small">
              <div className="ad-empty-text">Agents you’ve used will be listed here.</div>
            </div>
          ) : (
            <div className="ad-history">
              {history.map((a) => {
                const ok = a.status === 'ok'
                const dur = a.endedAt ? fmtDuration(a.endedAt - a.startedAt) : ''
                const key = `${a.id}-${a.startedAt}`
                const hasTools = !!a.tools && a.tools.length > 0
                const open = expanded.has(key)
                return (
                  <div className="ad-hist" key={key}>
                    <div
                      className={`ad-row ${a.status}${hasTools ? ' clickable' : ''}`}
                      onClick={hasTools ? () => toggle(key) : undefined}
                    >
                      <span className={`ad-status ${a.status}`}>{ok ? '✓' : '✗'}</span>
                      <span className={`ad-kind ${a.kind}`}>{KIND_LABEL[a.kind]}</span>
                      <span className="ad-name">{a.name}</span>
                      {a.detail && <span className="ad-detail">{a.detail}</span>}
                      {hasTools && <span className="ad-toolcount">{a.tools!.length} {open ? '▾' : '▸'}</span>}
                      {a.verifier && (
                        <span
                          className={`ad-verifier ${a.verifier}`}
                          title={
                            a.verifier === 'tool'
                              ? 'Verified by an objective tool oracle (typecheck/test/build)'
                              : 'Verified by an LLM rubric judge'
                          }
                        >
                          {a.verifier === 'tool' ? '🔧' : '⚖'}
                        </span>
                      )}
                      {a.kind === 'orchestration' && a.score !== undefined && (
                        <span className="ad-score">{a.score.toFixed(2)}</span>
                      )}
                      {typeof a.costUsd === 'number' && a.costUsd > 0 && (
                        <span className="ad-cost">${a.costUsd.toFixed(4)}</span>
                      )}
                      {dur && <span className="ad-dur">{dur}</span>}
                      <span className="ad-time">{relTime(a.endedAt ?? a.startedAt, now)}</span>
                    </div>
                    {open && hasTools && <ToolList tools={a.tools!} />}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
