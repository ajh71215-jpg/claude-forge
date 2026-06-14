// Eval scoring core (docs/SQUAD_ORCHESTRATION.md §6-8, TOKEN §5). PURE: golden-set
// validation + scoring + SAME-COMPUTE baseline delta + the §8 kill-criteria gate.
// The RUN loop (scripts/eval.mjs) needs a live session; this scoring/decision
// logic does not → it is exercised headlessly (npm run selftest) against the real
// eval/golden-set.json.
//
// Key principle (§2, §6): the meaningful comparison is orchestrated vs a single
// agent given the SAME token budget — winning by spending more is no win.

export type Difficulty = 'trivial' | 'easy' | 'moderate' | 'hard'

export interface GoldenTask {
  id: string
  category: string
  difficulty: Difficulty
  prompt: string
  /** Checklist criteria the output must satisfy (objective where possible). */
  rubric: string[]
}

export interface TaskRun {
  id: string
  passedCriteria: number
  totalCriteria: number
  costUsd: number
  tokens: number
}

export interface EvalSummary {
  tasks: number
  /** Fraction of tasks that satisfied EVERY criterion. */
  passRate: number
  /** Mean per-task criterion score. */
  avgScore: number
  costUsd: number
  tokens: number
}

export interface BaselineDelta {
  metric: string
  orchestrated: number
  baseline: number
  delta: number
  betterIfHigher: boolean
  wins: boolean
}

const DIFFICULTIES: Difficulty[] = ['trivial', 'easy', 'moderate', 'hard']

/** Validate an authored golden set: size, unique ids, complete fields. */
export function validateGoldenSet(
  set: GoldenTask[],
  minSize = 50
): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (!Array.isArray(set)) return { ok: false, errors: ['golden set is not an array'] }
  if (set.length < minSize) errors.push(`golden set has ${set.length} tasks, need ≥${minSize}`)
  const ids = new Set<string>()
  for (const t of set) {
    if (!t.id || !t.id.trim()) errors.push('task with empty id')
    else if (ids.has(t.id)) errors.push(`duplicate task id: ${t.id}`)
    else ids.add(t.id)
    if (!t.prompt || !t.prompt.trim()) errors.push(`task ${t.id}: empty prompt`)
    if (!t.category || !t.category.trim()) errors.push(`task ${t.id}: empty category`)
    if (!DIFFICULTIES.includes(t.difficulty)) errors.push(`task ${t.id}: bad difficulty ${t.difficulty}`)
    if (!Array.isArray(t.rubric) || t.rubric.length === 0) errors.push(`task ${t.id}: empty rubric`)
  }
  return { ok: errors.length === 0, errors }
}

/** Per-task score = fraction of criteria satisfied. */
export function scoreRun(run: TaskRun): number {
  return run.totalCriteria > 0 ? run.passedCriteria / run.totalCriteria : 0
}

export function summarize(runs: TaskRun[]): EvalSummary {
  const tasks = runs.length
  if (tasks === 0) return { tasks: 0, passRate: 0, avgScore: 0, costUsd: 0, tokens: 0 }
  const fullyPassed = runs.filter((r) => scoreRun(r) >= 1).length
  const avgScore = runs.reduce((s, r) => s + scoreRun(r), 0) / tasks
  return {
    tasks,
    passRate: fullyPassed / tasks,
    avgScore,
    costUsd: runs.reduce((s, r) => s + (r.costUsd || 0), 0),
    tokens: runs.reduce((s, r) => s + (r.tokens || 0), 0)
  }
}

/** Compare orchestrated vs baseline across quality + cost (same-compute lens). */
export function baselineDelta(orchestrated: EvalSummary, baseline: EvalSummary): BaselineDelta[] {
  const mk = (metric: string, o: number, b: number, betterIfHigher: boolean): BaselineDelta => ({
    metric,
    orchestrated: o,
    baseline: b,
    delta: o - b,
    betterIfHigher,
    wins: betterIfHigher ? o > b : o < b
  })
  return [
    mk('passRate', orchestrated.passRate, baseline.passRate, true),
    mk('avgScore', orchestrated.avgScore, baseline.avgScore, true),
    mk('costUsd', orchestrated.costUsd, baseline.costUsd, false),
    mk('tokens', orchestrated.tokens, baseline.tokens, false)
  ]
}

/**
 * §8 kill-criteria gate: orchestration must IMPROVE quality (passRate or avgScore)
 * WITHOUT spending more compute than the baseline. Winning quality by burning more
 * tokens is explicitly NOT a pass.
 */
export function gateVerdict(deltas: BaselineDelta[]): { pass: boolean; rationale: string } {
  const by = (m: string): BaselineDelta | undefined => deltas.find((d) => d.metric === m)
  const qualityWins = !!(by('passRate')?.wins || by('avgScore')?.wins)
  const cost = by('costUsd')
  const tokens = by('tokens')
  const costNotWorse = (cost ? cost.delta <= 0 : true) && (tokens ? tokens.delta <= 0 : true)
  const pass = qualityWins && costNotWorse
  const rationale = pass
    ? 'quality improved at equal-or-less compute → orchestration justified'
    : !qualityWins
      ? 'no quality gain → orchestration not justified'
      : 'quality gained only by spending more compute → not a fair win (§2/§8)'
  return { pass, rationale }
}
