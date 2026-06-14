// Squad view = subagent ORCHESTRATION monitor (docs/SQUAD_ORCHESTRATION.md §12).
// The Squad tab is a hybrid plan editor (AI-delegated or hand-specified subtasks)
// + a live Blackboard monitor showing each subtask's work-rate, tier and verdict.
//
// The legacy MANUAL parallel fan-out ("run N independent agents") was removed —
// Squad is orchestration-only. Hand-assignment lives on as the "Manual assign"
// toggle (vs AI-delegate) within this view.
//
// Layout: a DASHBOARD — command bar, a KPI stat strip, then a two-pane grid
// (plan editor + live blackboard). All form controls are CUSTOM (no native
// <select>/<checkbox>) so the surface renders identically across OSes.
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import type { Plan, Subtask, Topology, ModelTier } from '../../types'

const TOPOLOGIES: Topology[] = ['single', 'fanout', 'self_consistency', 'debate', 'cascade']
const TIERS: ModelTier[] = ['cascade', 'haiku', 'sonnet', 'opus']

interface RoleInfo {
  name: string
  description: string
  tier: string
  writeCapable: boolean
  systemAppend: string
}

type SubStatus = 'idle' | 'running' | 'verifying' | 'done' | 'failed' | 'stopped'
interface SubMon {
  status: SubStatus
  samples: { sample: number; tier: string }[]
  pass?: boolean
  score?: number
  attempt: number
}
const blankMon = (): SubMon => ({ status: 'idle', samples: [], attempt: 0 })

const STATUS_LABEL: Record<SubStatus, string> = {
  idle: 'idle',
  running: 'running',
  verifying: 'verifying',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped'
}

function seedPlan(): Plan {
  return {
    goal: 'Fix the flagged bug and cover it with a test',
    budgetUsd: 5,
    subtasks: [
      { id: 'scan', instruction: 'Scan the module for the correctness bug', topology: 'single', model: 'sonnet', role: 'explore', tools: [], rubric: 'bug located with file:line' },
      { id: 'fix', instruction: 'Apply the fix to the flagged function', topology: 'cascade', model: 'cascade', role: 'executor', tools: [], rubric: 'typecheck + build pass' },
      { id: 'test', instruction: 'Write tests covering the fix', topology: 'fanout', model: 'opus', role: 'test-engineer', tools: [], rubric: 'tests fail before, pass after', n: 2 }
    ],
    edges: [
      ['scan', 'fix'],
      ['fix', 'test']
    ]
  }
}

/* ---- custom dropdown (replaces native <select>) ---- */
interface Opt {
  value: string
  label: string
  hint?: string
  icon?: ReactNode
}
function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  title
}: {
  value: string
  options: Opt[]
  onChange: (v: string) => void
  ariaLabel?: string
  title?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cur = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`sq-dd ${open ? 'open' : ''}`} ref={ref}>
      <button
        type="button"
        className="sq-dd-btn"
        aria-label={ariaLabel}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sq-dd-val">
          {cur?.icon}
          {cur?.label ?? value}
        </span>
        <svg className="sq-dd-caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden>
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="sq-dd-menu" role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`sq-dd-opt ${o.value === value ? 'sel' : ''}`}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <span className="sq-dd-opt-main">
                {o.icon}
                {o.label}
              </span>
              {o.hint && <span className="sq-dd-opt-hint">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---- custom toggle (replaces native checkbox) ---- */
function Toggle({
  on,
  onChange,
  onLabel,
  offLabel
}: {
  on: boolean
  onChange: (v: boolean) => void
  onLabel: string
  offLabel: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`sq-toggle ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="sq-toggle-track">
        <span className="sq-toggle-thumb" />
      </span>
      <span className="sq-toggle-label">{on ? onLabel : offLabel}</span>
    </button>
  )
}

/* ---- KPI stat tile ---- */
function Stat({
  label,
  value,
  sub,
  tone,
  bar
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'ok' | 'live' | 'warn'
  bar?: number
}): JSX.Element {
  return (
    <div className={`sq-stat ${tone ?? ''}`}>
      <span className="sq-stat-label">{label}</span>
      <span className="sq-stat-value">{value}</span>
      {sub !== undefined && <span className="sq-stat-sub">{sub}</span>}
      {bar !== undefined && (
        <span className="sq-stat-bar">
          <span className="sq-stat-bar-fill" style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </span>
      )}
    </div>
  )
}

export default function SquadView(): JSX.Element {
  const [plan, setPlan] = useState<Plan>(seedPlan)
  const [aiDelegate, setAiDelegate] = useState(true)
  const [mon, setMon] = useState<Record<string, SubMon>>({})
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<{ spentUsd: number; stopped?: string } | null>(null)
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [loop, setLoop] = useState<{ iteration: number; passed: number; total: number; goalPass?: boolean } | null>(null)

  useEffect(() => {
    window.forge.orchestrate.roles().then(setRoles).catch(() => setRoles([]))
  }, [])

  useEffect(() => {
    return window.forge.orchestrate.onEvent((ev) => {
      if (ev.kind === 'sample') {
        setMon((m) => {
          const cur = m[ev.subtaskId] ?? blankMon()
          return {
            ...m,
            [ev.subtaskId]: { ...cur, status: 'running', samples: [...cur.samples, { sample: ev.sample, tier: ev.tier }] }
          }
        })
      } else if (ev.kind === 'conductor') {
        const e = ev.event
        if (!e.subtaskId) return
        const id = e.subtaskId
        setMon((m) => {
          const next = { ...(m[id] ?? blankMon()) }
          if (e.type === 'subtask-start') {
            next.status = 'running'
            next.attempt = e.attempt ?? 0
          } else if (e.type === 'verify') {
            next.status = 'verifying'
            next.pass = e.verdict?.pass
            next.score = e.verdict?.score
          } else if (e.type === 'revise') {
            next.status = 'running'
            next.attempt = e.attempt ?? next.attempt
          } else if (e.type === 'checkpoint') {
            next.status = e.verdict?.pass ? 'done' : 'failed'
          } else if (e.type === 'stopped') {
            next.status = 'stopped'
          }
          return { ...m, [id]: next }
        })
      } else if (ev.kind === 'loop') {
        const e = ev.event
        setLoop({
          iteration: (e.iteration ?? 0) + 1,
          passed: e.passed ?? 0,
          total: e.total ?? plan.subtasks.length,
          goalPass: e.goalPass
        })
      } else if (ev.kind === 'done') {
        setRunning(false)
        setSummary({ spentUsd: ev.spentUsd, stopped: ev.stopped })
      }
    })
  }, [])

  function resetMonitor(): void {
    const fresh: Record<string, SubMon> = {}
    for (const s of plan.subtasks) fresh[s.id] = blankMon()
    setMon(fresh)
    setSummary(null)
    setLoop(null)
    setRunning(true)
  }

  function dryRun(): void {
    resetMonitor()
    window.forge.orchestrate.dryRun(crypto.randomUUID(), plan).catch(() => setRunning(false))
  }

  function runLive(): void {
    resetMonitor()
    window.forge.orchestrate.run(crypto.randomUUID(), plan).catch(() => setRunning(false))
  }

  function runLoop(): void {
    resetMonitor()
    window.forge.orchestrate.runLoop(crypto.randomUUID(), plan, 3).catch(() => setRunning(false))
  }

  function patchSub(id: string, patch: Partial<Subtask>): void {
    setPlan((p) => ({ ...p, subtasks: p.subtasks.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  }
  function addSub(): void {
    setPlan((p) => ({
      ...p,
      subtasks: [
        ...p.subtasks,
        { id: `s${p.subtasks.length + 1}`, instruction: '', topology: 'single', model: 'cascade', tools: [], rubric: 'criteria' }
      ]
    }))
  }
  function removeSub(id: string): void {
    setPlan((p) => ({
      ...p,
      subtasks: p.subtasks.filter((s) => s.id !== id),
      edges: p.edges.filter(([a, b]) => a !== id && b !== id)
    }))
  }

  const done = Object.values(mon).filter((s) => s.status === 'done').length
  const active = Object.values(mon).filter((s) => s.status === 'running' || s.status === 'verifying').length
  const failed = Object.values(mon).filter((s) => s.status === 'failed' || s.status === 'stopped').length
  const total = plan.subtasks.length
  const pct = total ? Math.round((done / total) * 100) : 0
  const spent = summary?.spentUsd ?? 0
  const budget = plan.budgetUsd ?? 0

  const phase = running ? 'running' : summary ? (summary.stopped ? 'stopped' : 'complete') : 'ready'

  const roleOpts: Opt[] = [
    { value: '', label: 'no role', icon: <span className="sq-roledot" /> },
    ...roles.map((r) => ({
      value: r.name,
      label: r.name,
      hint: r.writeCapable ? 'write' : 'read',
      icon: <span className={`sq-roledot ${r.writeCapable ? 'w' : 'r'}`} />
    }))
  ]
  const topoOpts: Opt[] = TOPOLOGIES.map((t) => ({ value: t, label: t }))
  const tierOpts: Opt[] = TIERS.map((t) => ({ value: t, label: t }))

  return (
    <div className="squad orch-only">
      <div className="sq">
        {/* ---- command bar ---- */}
        <header className="sq-head">
          <div className="sq-head-main">
            <div className="sq-head-titlerow">
              <h2 className="sq-title">Squad</h2>
              <span className={`sq-phase ${phase}`}>
                <span className="sq-phase-dot" />
                {phase}
              </span>
            </div>
            <div className="sq-goal-wrap">
              <textarea
                className="sq-goal"
                rows={2}
                placeholder="What should the squad accomplish?"
                value={plan.goal}
                onChange={(e) => setPlan((p) => ({ ...p, goal: e.target.value }))}
              />
            </div>
          </div>
          <div className="sq-actions">
            <Toggle on={aiDelegate} onChange={setAiDelegate} onLabel="AI delegates" offLabel="Manual assign" />
            <div className="sq-run-group">
              <button className="sq-btn solid" onClick={dryRun} disabled={running}>
                {running ? (
                  <>
                    <span className="sq-spin" /> running
                  </>
                ) : (
                  <>▶ Dry run</>
                )}
              </button>
              <button className="sq-btn ghost" onClick={runLive} disabled={running} title="Live run: real read-only SDK calls routed by tier + haiku rubric judge">
                ▶ Live
              </button>
              <button className="sq-btn ghost" onClick={runLoop} disabled={running} title="Ralph loop: re-run until every subtask verifies (cap 3 iterations / budget)">
                ↻ Ralph
              </button>
            </div>
          </div>
        </header>

        {/* ---- KPI strip ---- */}
        <div className="sq-stats">
          <Stat label="Subtasks" value={total} sub={`${plan.edges.length} edges`} />
          <Stat label="Verified" value={`${done}/${total}`} sub={`${pct}%`} tone={total > 0 && done === total ? 'ok' : undefined} bar={pct} />
          <Stat label="Active" value={active} sub={failed > 0 ? `${failed} failed` : running ? 'in flight' : 'idle'} tone={active > 0 ? 'live' : failed > 0 ? 'warn' : undefined} />
          <Stat label="Spend" value={`$${spent.toFixed(2)}`} sub={budget ? `of $${budget.toFixed(0)} cap` : 'no cap'} bar={budget ? (spent / budget) * 100 : undefined} tone={budget && spent > budget ? 'warn' : undefined} />
        </div>

        {loop && (
          <div className={`sq-loop ${loop.goalPass ? 'done' : ''}`}>
            <span className="sq-loop-icon">↻</span>
            <span className="sq-loop-text">
              iteration {loop.iteration} · {loop.passed}/{loop.total} verified
              {loop.goalPass ? ' · goal complete' : ''}
            </span>
            {loop.goalPass && <span className="sq-loop-check">✓</span>}
          </div>
        )}

        {/* ---- two-pane body ---- */}
        <div className="sq-body">
          {/* PLAN editor */}
          <section className="sq-pane">
            <div className="sq-pane-head">
              <span className="sq-pane-title">Plan</span>
              <span className="sq-pane-meta">{total} subtasks</span>
            </div>
            <div className="sq-pane-scroll">
              {plan.subtasks.map((s, i) => (
                <div className="sq-task" key={s.id}>
                  <div className="sq-task-top">
                    <span className="sq-task-idx">{String(i + 1).padStart(2, '0')}</span>
                    <span className="sq-task-id">{s.id}</span>
                    <input
                      className="sq-task-instr"
                      value={s.instruction}
                      placeholder="describe the subtask…"
                      onChange={(e) => patchSub(s.id, { instruction: e.target.value })}
                    />
                    <button className="sq-task-del" title="Remove subtask" onClick={() => removeSub(s.id)}>
                      ✕
                    </button>
                  </div>
                  <div className="sq-task-controls">
                    <label className="sq-field">
                      <span className="sq-field-l">role</span>
                      <Dropdown value={s.role ?? ''} options={roleOpts} onChange={(v) => patchSub(s.id, { role: v || undefined })} ariaLabel="role" title="Agent role: persona + read-only/builder tool gate" />
                    </label>
                    <label className="sq-field">
                      <span className="sq-field-l">topology</span>
                      <Dropdown value={s.topology} options={topoOpts} onChange={(v) => patchSub(s.id, { topology: v as Topology })} ariaLabel="topology" />
                    </label>
                    <label className="sq-field">
                      <span className="sq-field-l">model</span>
                      <Dropdown value={s.model} options={tierOpts} onChange={(v) => patchSub(s.id, { model: v as ModelTier })} ariaLabel="model" />
                    </label>
                  </div>
                </div>
              ))}
              <button className="sq-add" onClick={addSub}>
                <span className="sq-add-plus">+</span> add subtask
              </button>
            </div>
          </section>

          {/* BLACKBOARD monitor */}
          <section className="sq-pane">
            <div className="sq-pane-head">
              <span className="sq-pane-title">Blackboard</span>
              <span className="sq-pane-meta">
                {done}/{total} done
                {summary && (
                  <span className="sq-pane-cost">
                    {' · '}${summary.spentUsd.toFixed(2)} · {summary.stopped ? `stopped: ${summary.stopped}` : 'complete'}
                  </span>
                )}
              </span>
            </div>
            <div className="sq-pane-scroll">
              {plan.subtasks.map((s) => {
                const m = mon[s.id] ?? blankMon()
                const tiers = [...new Set(m.samples.map((x) => x.tier))]
                return (
                  <div className={`sq-card ${m.status}`} key={s.id}>
                    <span className={`sq-dot ${m.status}`} />
                    <span className="sq-card-id">{s.id}</span>
                    {s.role && <span className="sq-card-role">{s.role}</span>}
                    <span className="sq-card-topo">{s.topology}</span>
                    <span className="sq-card-tiers">
                      {tiers.map((t) => (
                        <span className="sq-tier" key={t}>
                          {t}
                        </span>
                      ))}
                    </span>
                    <span className="sq-card-status">{STATUS_LABEL[m.status]}</span>
                    {m.samples.length > 0 && <span className="sq-card-samples">{m.samples.length}×</span>}
                    {m.pass !== undefined && (
                      <span className={`sq-verdict ${m.pass ? 'pass' : 'fail'}`}>
                        {m.pass ? '✓' : '✗'} {m.score !== undefined ? m.score.toFixed(2) : ''}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
