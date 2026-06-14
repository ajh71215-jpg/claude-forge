// Autonomous loop conductor — the native port of oh-my-claudecode's ralph /
// autopilot "loop until verified" workflow ("the boulder never stops"). It runs
// the deterministic plan repeatedly until every subtask's goal-level verdict
// passes, a hard iteration cap is hit, or the global budget is exhausted.
//
// It is a THIN outer loop over the existing conductor (executePlan): each
// iteration re-runs the plan, but already-passed subtasks are served from a
// persistent cross-iteration cache at zero cost — so only the still-failing work
// is re-attempted, with the cascade tier escalating each pass (priorFailures =
// attempt + iteration). Pure: model calls are injected via ConductorDeps, so the
// loop logic is headlessly testable (npm run selftest) like the rest of §-core.

import type { Artifact, Plan } from './orchestration'
import { deriveDeps } from './orchestration'
import { executePlan, validatePlan, type ConductorDeps, type PlanValidation } from './conductor'

/** Reverse of deriveDeps: subtask id → the ids that depend on it (its dependents). */
function buildDependents(plan: Plan): Map<string, string[]> {
  const deps = deriveDeps(plan)
  const dependents = new Map<string, string[]>()
  for (const st of plan.subtasks) dependents.set(st.id, [])
  for (const [id, dlist] of deps) for (const d of dlist) dependents.get(d)?.push(id)
  return dependents
}

/** Every transitive dependent of any id in `roots` (the work that must re-run). */
function transitiveDependents(roots: Iterable<string>, dependents: Map<string, string[]>): Set<string> {
  const out = new Set<string>()
  const stack = [...roots]
  while (stack.length) {
    const id = stack.pop() as string
    for (const dep of dependents.get(id) ?? []) {
      if (!out.has(dep)) {
        out.add(dep)
        stack.push(dep)
      }
    }
  }
  return out
}

export interface LoopEvent {
  type: 'iteration-start' | 'iteration-result' | 'loop-done'
  iteration?: number
  goalPass?: boolean
  spentUsd?: number
  /** Pass/total subtask count for the iteration (progress readout). */
  passed?: number
  total?: number
  detail?: string
}

export interface LoopOptions {
  /** Hard cap on whole-plan passes (runaway guard). Default 3. */
  maxIterations?: number
  /** Per-subtask verify→revise retries inside one iteration. Default 1. */
  maxRevisions?: number
  /** Pre-spend cost projection per subtask for the budget governor. */
  projectCostUsd?: (subtaskId: string) => number
  onEvent?: (e: LoopEvent) => void
}

export interface LoopResult {
  iterations: number
  goalPass: boolean
  artifacts: Artifact[]
  spentUsd: number
  /** Set when the loop halted early ('invalid-plan' | 'budget' | 'max-iterations'). */
  stopped?: string
  validation: PlanValidation
}

/**
 * Run the plan in a loop until the goal is verified (all subtasks pass), the
 * iteration cap is reached, or the global budget is spent. Passed subtasks are
 * cached across iterations (zero re-cost); failing ones re-run with an escalated
 * tier. The global budget is enforced by shrinking the per-iteration budget by
 * what has already been spent — so the conductor's existing hard-cap governor
 * stops an overrun without the loop ever exceeding plan.budgetUsd.
 */
export async function runLoop(
  plan: Plan,
  deps: ConductorDeps,
  opts: LoopOptions = {}
): Promise<LoopResult> {
  const validation = validatePlan(plan)
  const emit = opts.onEvent ?? ((): void => {})
  if (!validation.ok) {
    emit({ type: 'loop-done', goalPass: false, detail: 'invalid-plan' })
    return { iterations: 0, goalPass: false, artifacts: [], spentUsd: 0, stopped: 'invalid-plan', validation }
  }

  const maxIter = Math.max(1, Math.floor(opts.maxIterations ?? 3))
  const total = plan.subtasks.length
  const passed = new Map<string, Artifact>()
  const dependents = buildDependents(plan)
  let spentUsd = 0
  let lastArtifacts: Artifact[] = []
  let stopped: string | undefined
  let ran = 0

  for (let iteration = 0; iteration < maxIter; iteration++) {
    const remaining = plan.budgetUsd - spentUsd
    if (remaining <= 0) {
      stopped = 'budget'
      break
    }
    ran = iteration + 1

    // Partial re-execution correctness: a downstream subtask that passed against
    // a still-FAILING upstream's output is stale once that upstream is re-worked.
    // Invalidate the transitive dependents of every not-yet-passed subtask so
    // they re-run this iteration against the corrected inputs (a subtask whose
    // whole dependency chain already passed stays cached at zero cost).
    const notPassed = plan.subtasks.map((s) => s.id).filter((id) => !passed.has(id))
    for (const id of transitiveDependents(notPassed, dependents)) passed.delete(id)
    emit({ type: 'iteration-start', iteration, passed: passed.size, total })

    const res = await executePlan(
      { ...plan, budgetUsd: remaining },
      {
        maxRevisions: opts.maxRevisions ?? 1,
        projectCostUsd: opts.projectCostUsd ? (st) => opts.projectCostUsd!(st.id) : undefined,
        onEvent: deps.onEvent,
        // Cache hit → serve the prior passing artifact at zero cost so only the
        // still-failing subtasks consume budget this iteration.
        runSubtask: async (st, attempt, bb) => {
          const hit = passed.get(st.id)
          if (hit) return { ...hit, costUsd: 0 }
          // Escalate across iterations: each whole-plan pass counts as a failure.
          return deps.runSubtask(st, attempt + iteration, bb)
        },
        verify: async (st, art, bb) => {
          const hit = passed.get(st.id)
          if (hit && hit.verdict) return hit.verdict
          return deps.verify(st, art, bb)
        }
      }
    )

    spentUsd += res.spentUsd
    lastArtifacts = res.artifacts
    for (const a of res.artifacts) if (a.verdict?.pass) passed.set(a.subtaskId, a)

    const goalPass = passed.size === total
    emit({ type: 'iteration-result', iteration, goalPass, spentUsd, passed: passed.size, total })

    if (res.stopped) {
      stopped = res.stopped
      break
    }
    if (goalPass) break
  }

  const goalPass = passed.size === total
  if (!goalPass && !stopped && ran >= maxIter) stopped = 'max-iterations'
  emit({ type: 'loop-done', iteration: ran, goalPass, spentUsd, passed: passed.size, total, detail: stopped })

  return { iterations: ran, goalPass, artifacts: lastArtifacts, spentUsd, stopped, validation }
}
