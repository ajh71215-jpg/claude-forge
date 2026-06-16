// Per-subtask topology executors (docs/SQUAD_ORCHESTRATION.md §4 토폴로지 라우터).
// Pure orchestration over an INJECTED sample-runner + verifier → headlessly
// testable (npm run selftest). The conductor calls this per subtask; the actual
// model calls live behind `deps.run`.
//
// Validated mechanisms:
//  - fanout best-of-N selected by the VERIFIER (not the generator) — external
//    selection closes the verification gap.
//  - self-consistency with early-stop — stop sampling once votes converge.
//  - multi-agent debate (ICML 2024, Du et al.) — rounds until the panel settles.
//  - cascade — escalate tier only after an external failure (target compute).

import type { Artifact, Subtask, Verdict } from './orchestration'
import { aggregateVotes, debateConverged, shouldEarlyStop, type JudgeVote } from './verifier'
import { escalate, route, type Tier } from './routing'
import { getRole } from './roles'

export type SampleRunner = (
  subtask: Subtask,
  ctx: { attempt: number; sample: number; tier: Tier }
) => Promise<Artifact>
export type SampleVerifier = (subtask: Subtask, artifact: Artifact) => Promise<Verdict>

export interface TopologyDeps {
  run: SampleRunner
  verify: SampleVerifier
  /** Default sample count for fanout/self_consistency (subtask.n wins). */
  defaultN?: number
  /** Ceiling for debate rounds / cascade steps. */
  maxSteps?: number
}

export interface TopologyResult {
  /** The chosen artifact for this subtask. */
  artifact: Artifact
  /** Verdict for the chosen artifact / aggregate. */
  verdict: Verdict
  /** Every sample produced (for the Blackboard monitor). */
  samples: Artifact[]
  rationale: string
}

/**
 * Run one subtask under its declared topology. Returns the chosen artifact, its
 * verdict, and all samples (so the Squad-tab monitor can show per-sample work).
 */
export async function executeTopology(subtask: Subtask, deps: TopologyDeps): Promise<TopologyResult> {
  const baseTier = route({
    instruction: subtask.instruction,
    tier: subtask.model,
    roleTier: getRole(subtask.role)?.tier
  }).tier
  const n = Math.max(1, subtask.n ?? deps.defaultN ?? 3)
  const maxSteps = Math.max(1, deps.maxSteps ?? 3)
  const samples: Artifact[] = []

  const runOne = async (
    sample: number,
    attempt: number,
    tier: Tier
  ): Promise<{ art: Artifact; v: Verdict }> => {
    const art = await deps.run(subtask, { attempt, sample, tier })
    samples.push(art)
    const v = await deps.verify(subtask, art)
    art.verdict = v
    return { art, v }
  }

  switch (subtask.topology) {
    case 'fanout': {
      const runs: { art: Artifact; v: Verdict }[] = []
      for (let i = 0; i < n; i++) runs.push(await runOne(i, 0, baseTier))
      let best = runs[0]
      for (const r of runs) if (r.v.score > best.v.score) best = r // verifier-selected
      return { artifact: best.art, verdict: best.v, samples, rationale: `fanout n=${n}, best score=${best.v.score}` }
    }
    case 'self_consistency': {
      const votes: JudgeVote[] = []
      const runs: { art: Artifact; v: Verdict }[] = []
      for (let i = 0; i < n; i++) {
        const r = await runOne(i, 0, baseTier)
        runs.push(r)
        votes.push({ pass: r.v.pass, score: r.v.score, confidence: r.v.confidence })
        if (shouldEarlyStop(votes)) break
      }
      const agg = aggregateVotes(votes)
      const rep = runs.find((r) => r.v.pass === agg.pass) ?? runs[0]
      const verdict: Verdict = {
        subtaskId: subtask.id,
        pass: agg.pass,
        score: agg.score,
        confidence: agg.confidence,
        rationale: `self-consistency ${votes.length} votes, agreement=${agg.agreement.toFixed(2)}`,
        evidence: votes.map((v, i) => `#${i}:${v.pass ? 'pass' : 'fail'}`)
      }
      return { artifact: rep.art, verdict, samples, rationale: verdict.rationale }
    }
    case 'debate': {
      const rounds: boolean[] = []
      const runs: { art: Artifact; v: Verdict }[] = []
      for (let i = 0; i < maxSteps; i++) {
        const r = await runOne(i, 0, baseTier)
        runs.push(r)
        rounds.push(r.v.pass)
        if (debateConverged(rounds, maxSteps)) break
      }
      const last = runs[runs.length - 1]
      return { artifact: last.art, verdict: last.v, samples, rationale: `debate ${rounds.length} round(s)` }
    }
    case 'cascade': {
      let tier = baseTier
      let r = await runOne(0, 0, tier)
      let step = 1
      while (!r.v.pass && step < maxSteps) {
        tier = escalate(tier)
        r = await runOne(step, step, tier)
        step++
      }
      return { artifact: r.art, verdict: r.v, samples, rationale: `cascade ${step} step(s), final tier=${tier}` }
    }
    case 'single':
    default: {
      const { art, v } = await runOne(0, 0, baseTier)
      return { artifact: art, verdict: v, samples, rationale: 'single run' }
    }
  }
}
