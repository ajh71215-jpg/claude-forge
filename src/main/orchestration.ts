// Orchestration data contracts (docs/SQUAD_ORCHESTRATION.md §5) + pure graph
// helpers. No electron/SDK imports → unit-testable headlessly (npm run selftest).
//
// Validated mechanism: blueprint-first DETERMINISTIC plans (arXiv 2508.02721,
// industry hybrid standard) executed as a typed DAG — Forge owns the skeleton,
// the model only decides tactics inside the plan's bounds.

export type Topology = 'single' | 'fanout' | 'self_consistency' | 'debate' | 'cascade'
export type ModelTier = 'haiku' | 'sonnet' | 'opus' | 'cascade'

export interface Subtask {
  id: string
  instruction: string
  topology: Topology
  model: ModelTier
  tools: string[]
  /**
   * Optional agent role (roles.ts) — assigns a persona, a default tier, and the
   * read-only/builder tool gate. Unknown roles are rejected by validatePlan.
   */
  role?: string
  /** Success criteria for the verifier. Empty rubric = unverifiable → rejected. */
  rubric: string
  /**
   * Optional objective verification commands (e.g. `npm run typecheck`, `npm test`).
   * When present, the live verifier runs these as a TOOL ORACLE (no model judge) —
   * the preferred verifier (docs/SQUAD_ORCHESTRATION.md §3): grounded in a real
   * toolchain result, so there is no verification gap / reward-hacking surface.
   */
  verifyCommands?: string[]
  /** Subtask ids that must complete first (merged with Plan.edges). */
  deps?: string[]
  /** Samples for fanout / self_consistency / debate. */
  n?: number
  maxTurns?: number
}

export interface Plan {
  goal: string
  subtasks: Subtask[]
  /** DAG edges [from, to]: `to` depends on `from`. */
  edges: [string, string][]
  budgetUsd: number
}

export interface Verdict {
  subtaskId: string
  pass: boolean
  score: number
  confidence: number
  rationale: string
  evidence: string[]
}

export interface Artifact {
  subtaskId: string
  output: string
  costUsd: number
  verdict?: Verdict
}

export const TOPOLOGIES: Topology[] = [
  'single',
  'fanout',
  'self_consistency',
  'debate',
  'cascade'
]
export const MODEL_TIERS: ModelTier[] = ['haiku', 'sonnet', 'opus', 'cascade']

/** Build id → dependency-ids from Plan.edges merged with each subtask's deps. */
export function deriveDeps(plan: Plan): Map<string, string[]> {
  const deps = new Map<string, string[]>()
  for (const st of plan.subtasks) deps.set(st.id, [...(st.deps ?? [])])
  for (const [from, to] of plan.edges) {
    const list = deps.get(to)
    if (list && !list.includes(from)) list.push(from)
  }
  return deps
}

/**
 * Kahn topological sort. `cycle` is true when the graph can't be fully ordered
 * (a cyclic plan is rejected by validatePlan — it can never run to completion).
 * Dangling deps (ids not in the plan) are ignored here; validatePlan flags them.
 */
export function topoSort(plan: Plan): { order: string[]; cycle: boolean } {
  const ids = plan.subtasks.map((s) => s.id)
  const idSet = new Set(ids)
  const deps = deriveDeps(plan)
  const indeg = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const id of ids) {
    dependents.set(id, [])
    indeg.set(id, 0)
  }
  for (const id of ids) {
    for (const d of deps.get(id) ?? []) {
      if (!idSet.has(d)) continue
      indeg.set(id, (indeg.get(id) ?? 0) + 1)
      dependents.get(d)?.push(id)
    }
  }
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift() as string
    order.push(id)
    for (const dep of dependents.get(id) ?? []) {
      indeg.set(dep, (indeg.get(dep) ?? 0) - 1)
      if ((indeg.get(dep) ?? 0) === 0) queue.push(dep)
    }
  }
  return { order, cycle: order.length !== ids.length }
}
