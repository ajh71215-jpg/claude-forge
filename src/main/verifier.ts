// External verification + judge-bias mitigation (docs/SQUAD_ORCHESTRATION.md §3,
// §4). Pure aggregation logic — the actual judge model calls are INJECTED, so the
// decision rules are headlessly testable (npm run selftest).
//
// Validated mechanisms:
//  - Multi-agent debate reduces hallucination — ICML 2024, Du et al.
//    (peer-reviewed; the strongest evidence in the plan's ledger).
//  - Self-consistency early-stop: stop sampling once votes converge.
//  - Pairwise order-swap cancels LLM judges' documented position bias.
//  - Confidence-weighted voting: a hesitant judge counts for less.
// Ties always resolve to FAIL — an unverified artifact must never pass (§3
// reward-hacking / verification-gap guard).

export interface JudgeVote {
  pass: boolean
  score: number
  confidence: number
  rationale?: string
}

export interface Aggregate {
  pass: boolean
  score: number
  confidence: number
  votes: number
  /** Fraction agreeing with the majority verdict (1 = unanimous). */
  agreement: number
}

/**
 * Combine independent judge votes. 'majority' = unweighted pass count;
 * 'confidence' = confidence-weighted. Ties (equal weight) resolve to fail.
 */
export function aggregateVotes(
  votes: JudgeVote[],
  mode: 'majority' | 'confidence' = 'majority'
): Aggregate {
  const n = votes.length
  if (n === 0) return { pass: false, score: 0, confidence: 0, votes: 0, agreement: 0 }
  let passW = 0
  let failW = 0
  for (const v of votes) {
    const w = mode === 'confidence' ? Math.max(0, Math.min(1, v.confidence)) : 1
    if (v.pass) passW += w
    else failW += w
  }
  const passCount = votes.filter((v) => v.pass).length
  const score = votes.reduce((s, v) => s + v.score, 0) / n
  const confidence = votes.reduce((s, v) => s + v.confidence, 0) / n
  const agreement = Math.max(passCount, n - passCount) / n
  return { pass: passW > failW, score, confidence, votes: n, agreement }
}

/**
 * Self-consistency early stop: once a fraction `threshold` of votes agree on the
 * same verdict (and we have at least `minVotes`), further sampling is wasted.
 */
export function shouldEarlyStop(votes: JudgeVote[], threshold = 0.75, minVotes = 3): boolean {
  if (votes.length < minVotes) return false
  const passCount = votes.filter((v) => v.pass).length
  const agree = Math.max(passCount, votes.length - passCount) / votes.length
  return agree >= threshold
}

export type PairChoice = 'a' | 'b' | 'tie'

/**
 * Pairwise comparison with order-swap to cancel position bias: ask the judge
 * (a,b) then (b,a) and reconcile in the original a/b frame. If the two orders
 * disagree, the judge is order-sensitive → 'tie' (neither wins). Validated: LLM
 * judges have a documented first-/recency-position bias; swapping is the standard
 * control.
 */
export async function pairwiseWithSwap(
  judge: (x: string, y: string) => Promise<PairChoice>,
  a: string,
  b: string
): Promise<PairChoice> {
  const first = await judge(a, b)
  const second = await judge(b, a)
  // Re-frame the swapped answer: in judge(b,a), 'a' means b won, 'b' means a won.
  const secondMapped: PairChoice = second === 'a' ? 'b' : second === 'b' ? 'a' : 'tie'
  return first === secondMapped ? first : 'tie'
}

/**
 * Debate convergence: stop when the last two rounds agree (the panel settled) or
 * maxRounds is reached. `rounds` is each round's majority verdict (true = pass).
 */
export function debateConverged(rounds: boolean[], maxRounds = 3): boolean {
  if (rounds.length >= maxRounds) return true
  if (rounds.length < 2) return false
  return rounds[rounds.length - 1] === rounds[rounds.length - 2]
}
