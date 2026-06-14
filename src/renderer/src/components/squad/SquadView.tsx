// Squad view = subagent ORCHESTRATION monitor (docs/SQUAD_ORCHESTRATION.md §12).
// The Squad tab is a hybrid plan editor (AI-delegated or hand-specified subtasks)
// + a live Blackboard monitor showing each subtask's work-rate, tier and verdict.
//
// The legacy MANUAL parallel fan-out ("run N independent agents") was removed —
// Squad is orchestration-only. Hand-assignment lives on as the "Manual assign"
// toggle (vs AI-delegate) within this view.
import { useEffect, useState, type JSX } from 'react'
import type { Plan, Subtask, Topology, ModelTier } from '../../types'

const TOPOLOGIES: Topology[] = ['single', 'fanout', 'self_consistency', 'debate', 'cascade']
const TIERS: ModelTier[] = ['cascade', 'haiku', 'sonnet', 'opus']

type SubStatus = 'idle' | 'running' | 'verifying' | 'done' | 'failed' | 'stopped'
interface SubMon {
  status: SubStatus
  samples: { sample: number; tier: string }[]
  pass?: boolean
  score?: number
  attempt: number
}
const blankMon = (): SubMon => ({ status: 'idle', samples: [], attempt: 0 })

function seedPlan(): Plan {
  return {
    goal: 'Fix the flagged bug and cover it with a test',
    budgetUsd: 5,
    subtasks: [
      { id: 'scan', instruction: 'Scan the module for the correctness bug', topology: 'single', model: 'sonnet', tools: [], rubric: 'bug located with file:line' },
      { id: 'fix', instruction: 'Apply the fix to the flagged function', topology: 'cascade', model: 'cascade', tools: [], rubric: 'typecheck + build pass' },
      { id: 'test', instruction: 'Write tests covering the fix', topology: 'fanout', model: 'opus', tools: [], rubric: 'tests fail before, pass after', n: 2 }
    ],
    edges: [
      ['scan', 'fix'],
      ['fix', 'test']
    ]
  }
}

export default function SquadView(): JSX.Element {
  const [plan, setPlan] = useState<Plan>(seedPlan)
  const [aiDelegate, setAiDelegate] = useState(true)
  const [mon, setMon] = useState<Record<string, SubMon>>({})
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<{ spentUsd: number; stopped?: string } | null>(null)

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
      } else if (ev.kind === 'done') {
        setRunning(false)
        setSummary({ spentUsd: ev.spentUsd, stopped: ev.stopped })
      }
    })
  }, [])

  function dryRun(): void {
    const fresh: Record<string, SubMon> = {}
    for (const s of plan.subtasks) fresh[s.id] = blankMon()
    setMon(fresh)
    setSummary(null)
    setRunning(true)
    window.forge.orchestrate.dryRun(crypto.randomUUID(), plan).catch(() => setRunning(false))
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

  return (
    <div className="squad orch-only">
      <div className="orch">
        <div className="orch-head">
          <textarea
            className="orch-goal"
            rows={2}
            placeholder="Goal — what should the squad accomplish?"
            value={plan.goal}
            onChange={(e) => setPlan((p) => ({ ...p, goal: e.target.value }))}
          />
          <div className="orch-head-controls">
            <label className={`orch-delegate ${aiDelegate ? 'on' : ''}`}>
              <input type="checkbox" checked={aiDelegate} onChange={(e) => setAiDelegate(e.target.checked)} />
              {aiDelegate ? 'AI delegates' : 'Manual assign'}
            </label>
            <button className="primary orch-dry" onClick={dryRun} disabled={running}>
              {running ? '… running' : '▶ DRY RUN'}
            </button>
            <button className="mini-btn" disabled title="Live run needs a Claude session (engine wired; model adapter pending)">
              ▶ RUN (live)
            </button>
          </div>
        </div>

        <div className="orch-body">
          <div className="orch-plan">
            <div className="orch-section">PLAN · {plan.subtasks.length} subtasks</div>
            {plan.subtasks.map((s) => (
              <div className="orch-subtask" key={s.id}>
                <span className="orch-sub-id">{s.id}</span>
                <input
                  className="orch-sub-instr"
                  value={s.instruction}
                  placeholder="instruction"
                  onChange={(e) => patchSub(s.id, { instruction: e.target.value })}
                />
                <select value={s.topology} onChange={(e) => patchSub(s.id, { topology: e.target.value as Topology })}>
                  {TOPOLOGIES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select value={s.model} onChange={(e) => patchSub(s.id, { model: e.target.value as ModelTier })}>
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button className="ar-x" title="Remove" onClick={() => removeSub(s.id)}>
                  ✕
                </button>
              </div>
            ))}
            <button className="mini-btn" onClick={addSub}>
              + add subtask
            </button>
          </div>

          <div className="orch-monitor">
            <div className="orch-section">
              BLACKBOARD MONITOR · {done}/{plan.subtasks.length} done
              {summary && (
                <span className="orch-summary">
                  {' '}
                  · ${summary.spentUsd.toFixed(2)} {summary.stopped ? `· stopped: ${summary.stopped}` : '· complete'}
                </span>
              )}
            </div>
            {plan.subtasks.map((s) => {
              const m = mon[s.id] ?? blankMon()
              const tiers = [...new Set(m.samples.map((x) => x.tier))]
              return (
                <div className={`orch-card ${m.status}`} key={s.id}>
                  <span className={`orch-dot ${m.status}`} />
                  <span className="orch-card-id">{s.id}</span>
                  <span className="orch-card-topo">{s.topology}</span>
                  <span className="orch-card-tiers">
                    {tiers.map((t) => (
                      <span className="orch-tier" key={t}>
                        {t}
                      </span>
                    ))}
                  </span>
                  <span className="orch-card-status">{m.status}</span>
                  {m.samples.length > 0 && <span className="orch-card-samples">{m.samples.length}×</span>}
                  {m.pass !== undefined && (
                    <span className={`orch-verdict ${m.pass ? 'pass' : 'fail'}`}>
                      {m.pass ? '✓' : '✗'} {m.score !== undefined ? m.score.toFixed(2) : ''}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
