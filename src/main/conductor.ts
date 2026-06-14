// Deterministic plan executor + plan-validation gate + budget governor
// (docs/SQUAD_ORCHESTRATION.md §4, §7 Phase 1, §8). A thin state machine over the
// typed Plan DAG: it owns control flow (topological order, verify→revise, cascade
// escalation, checkpoints, hard budget cap) while model calls are INJECTED via
// `deps` — so the orchestration logic is headlessly testable without a live
// session (npm run selftest).
//
// Validated mechanisms: blueprint-first determinism (2508.02721), external/
// tool-based verification preferred over self-grading (verification-gap guard),
// target-compute cascade, bounded execution (runaway guard), per-step
// checkpointing (caps error compounding), pre-spend budget projection (§8
// subscription guard).

import type { Artifact, Plan, Subtask, Verdict } from './orchestration'
import { MODEL_TIERS, TOPOLOGIES, topoSort } from './orchestration'
import { isRole } from './roles'

export interface PlanValidation {
  ok: boolean
  errors: string[]
}

/**
 * Plan self-validation gate (§4: "plan은 미검증 단일 실패점이므로 필수"). Rejects a
 * plan BEFORE any compute is spent: unique non-empty ids, valid edge refs, acyclic
 * DAG, known topology/tier enums, non-empty rubric (no rubric = unverifiable), and
 * a positive budget.
 */
export function validatePlan(plan: Plan): PlanValidation {
  const errors: string[] = []
  if (!plan || typeof plan !== 'object') return { ok: false, errors: ['plan is not an object'] }
  if (!plan.goal || !plan.goal.trim()) errors.push('goal is empty')
  if (!Array.isArray(plan.subtasks) || plan.subtasks.length === 0) errors.push('no subtasks')
  if (!(plan.budgetUsd > 0)) errors.push('budgetUsd must be > 0')

  const ids = new Set<string>()
  for (const st of plan.subtasks ?? []) {
    if (!st.id || !st.id.trim()) errors.push('subtask with empty id')
    else if (ids.has(st.id)) errors.push(`duplicate subtask id: ${st.id}`)
    else ids.add(st.id)
    if (!st.instruction || !st.instruction.trim())
      errors.push(`subtask ${st.id || '?'}: empty instruction`)
    if (!st.rubric || !st.rubric.trim())
      errors.push(`subtask ${st.id || '?'}: empty rubric (unverifiable)`)
    if (!TOPOLOGIES.includes(st.topology))
      errors.push(`subtask ${st.id || '?'}: bad topology ${String(st.topology)}`)
    if (!MODEL_TIERS.includes(st.model))
      errors.push(`subtask ${st.id || '?'}: bad model tier ${String(st.model)}`)
    if (st.role !== undefined && !isRole(st.role))
      errors.push(`subtask ${st.id || '?'}: unknown role ${String(st.role)}`)
  }
  for (const edge of plan.edges ?? []) {
    const [from, to] = edge
    if (!ids.has(from)) errors.push(`edge from unknown subtask: ${String(from)}`)
    if (!ids.has(to)) errors.push(`edge to unknown subtask: ${String(to)}`)
  }
  if (errors.length === 0 && topoSort(plan).cycle) errors.push('plan graph has a cycle')
  return { ok: errors.length === 0, errors }
}

/** Pre-execution cost projection for the budget governor / UI pre-flight (§8). */
export function projectPlanCost(plan: Plan, costOf: (st: Subtask) => number): number {
  return plan.subtasks.reduce((sum, st) => sum + (costOf(st) || 0), 0)
}

export interface ConductorEvent {
  type: 'subtask-start' | 'subtask-result' | 'verify' | 'revise' | 'checkpoint' | 'stopped'
  subtaskId?: string
  attempt?: number
  detail?: string
  verdict?: Verdict
  spentUsd?: number
}

export interface ConductorDeps {
  /** Run a subtask. attempt is 0-based; >0 is a revise retry (escalate the tier). */
  runSubtask: (
    subtask: Subtask,
    attempt: number,
    blackboard: Map<string, Artifact>
  ) => Promise<Artifact>
  /** External verifier (tool-based preferred; rubric/debate fallbacks). */
  verify: (
    subtask: Subtask,
    artifact: Artifact,
    blackboard: Map<string, Artifact>
  ) => Promise<Verdict>
  /** Pre-spend cost projection per subtask for the budget governor (optional). */
  projectCostUsd?: (subtask: Subtask) => number
  /** Max verify→revise retries per subtask (default 1). */
  maxRevisions?: number
  /** Observability sink (Squad-tab Blackboard monitor). */
  onEvent?: (e: ConductorEvent) => void
}

export interface ConductorResult {
  artifacts: Artifact[]
  blackboard: Map<string, Artifact>
  spentUsd: number
  /** Set when the run halted early ('invalid-plan' | 'budget'). */
  stopped?: string
  validation: PlanValidation
}

/**
 * Execute a validated plan deterministically. Honors the DAG order, runs each
 * subtask, verifies it, and on failure revises (re-running with an escalated
 * cascade tier) up to maxRevisions. A hard budget cap is checked before every
 * spend (§8); the run halts with `stopped:'budget'` rather than overrun.
 * Checkpoints fire after each subtask so error compounding is bounded.
 */
export async function executePlan(plan: Plan, deps: ConductorDeps): Promise<ConductorResult> {
  const validation = validatePlan(plan)
  const blackboard = new Map<string, Artifact>()
  const artifacts: Artifact[] = []
  let spentUsd = 0
  const emit = deps.onEvent ?? ((): void => {})

  if (!validation.ok) {
    emit({ type: 'stopped', detail: `invalid plan: ${validation.errors.join('; ')}` })
    return { artifacts, blackboard, spentUsd, stopped: 'invalid-plan', validation }
  }

  const maxRev = Math.max(0, Math.floor(deps.maxRevisions ?? 1))
  const { order } = topoSort(plan)
  const byId = new Map(plan.subtasks.map((s) => [s.id, s]))

  for (const id of order) {
    const st = byId.get(id) as Subtask
    const projected = deps.projectCostUsd ? deps.projectCostUsd(st) : 0
    // Budget governor: hard-cap before spending.
    if (spentUsd + projected > plan.budgetUsd) {
      emit({
        type: 'stopped',
        subtaskId: id,
        detail: `budget cap: ${spentUsd}+${projected}>${plan.budgetUsd}`,
        spentUsd
      })
      return { artifacts, blackboard, spentUsd, stopped: 'budget', validation }
    }

    let attempt = 0
    let artifact: Artifact
    for (;;) {
      emit({ type: 'subtask-start', subtaskId: id, attempt })
      artifact = await deps.runSubtask(st, attempt, blackboard)
      spentUsd += artifact.costUsd ?? 0
      emit({ type: 'subtask-result', subtaskId: id, attempt, spentUsd })

      const verdict = await deps.verify(st, artifact, blackboard)
      artifact.verdict = verdict
      emit({ type: 'verify', subtaskId: id, attempt, verdict })

      if (verdict.pass || attempt >= maxRev) break

      attempt++
      emit({
        type: 'revise',
        subtaskId: id,
        attempt,
        detail: 'verification failed → escalate tier + retry'
      })
      // Re-check budget before paying for a revise.
      if (spentUsd + projected > plan.budgetUsd) {
        emit({ type: 'stopped', subtaskId: id, detail: 'budget cap before revise', spentUsd })
        blackboard.set(id, artifact)
        artifacts.push(artifact)
        return { artifacts, blackboard, spentUsd, stopped: 'budget', validation }
      }
    }

    blackboard.set(id, artifact)
    artifacts.push(artifact)
    emit({ type: 'checkpoint', subtaskId: id, spentUsd, verdict: artifact.verdict })
  }

  return { artifacts, blackboard, spentUsd, validation }
}
