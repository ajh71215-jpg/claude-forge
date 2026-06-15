// Shared model router / cascade — single owner (docs/TOKEN_OPTIMIZATION.md §3
// lever 4 ∩ docs/SQUAD_ORCHESTRATION.md §4). BOTH the cost optimizer (cost-saver
// → difficulty router) and the conductor (cascade escalation) import from here so
// the routing policy is never duplicated.
//
// Validated mechanism: difficulty-based routing + cheap→expensive cascade that
// escalates ONLY when verification fails (target-compute, not brute-force N).
// The cascade ladder + escalate-on-failure policy is the validated part; the
// heuristic classifier below is a transparent default the live golden-set eval is
// meant to tune — never treated as a precise oracle. Pure: no electron/SDK
// imports → headlessly testable (npm run selftest).

import type { Effort } from './agent/types'
import type { ModelTier } from './orchestration'

export type Tier = 'haiku' | 'sonnet' | 'opus'
export type Difficulty = 'trivial' | 'easy' | 'moderate' | 'hard'

export interface RouteInput {
  instruction: string
  /** Explicit tier from a Plan subtask; 'cascade'/undefined → auto-classify. */
  tier?: ModelTier
  /**
   * Default tier from the subtask's agent role (roles.ts). Used when the plan
   * leaves the model on 'cascade' — a role's tier outranks the heuristic
   * classifier but yields to an explicit non-cascade plan tier.
   */
  roleTier?: Tier
  /** Verification failures so far → walk the cascade ladder up. */
  priorFailures?: number
}

export interface RouteDecision {
  tier: Tier
  /** Model alias the SDK accepts ('haiku' | 'sonnet' | 'opus'). */
  model: string
  effort: Effort
  difficulty: Difficulty
  rationale: string
}

const CASCADE_LADDER: Tier[] = ['haiku', 'sonnet', 'opus']

/** Next tier up the cascade ladder (caps at opus). */
export function escalate(tier: Tier): Tier {
  const i = CASCADE_LADDER.indexOf(tier)
  return CASCADE_LADDER[Math.min(i + 1, CASCADE_LADDER.length - 1)]
}

const HARD_HINTS =
  /\b(architect|refactor|design|migrat|debug|root[\s-]?cause|concurren|race condition|security|distributed|optimi[sz]e|prove|proof|algorithm|complex)\b/i
const TRIVIAL_HINTS = /\b(rename|typo|format|comment|bump|lint|spelling|import|whitespace)\b/i

export function classifyDifficulty(instruction: string): Difficulty {
  const text = (instruction ?? '').trim()
  const len = text.length
  if (TRIVIAL_HINTS.test(text) && len < 160) return 'trivial'
  if (HARD_HINTS.test(text) || len > 800) return 'hard'
  if (len > 280) return 'moderate'
  return 'easy'
}

const TIER_BY_DIFFICULTY: Record<Difficulty, Tier> = {
  trivial: 'haiku',
  easy: 'haiku',
  moderate: 'sonnet',
  hard: 'opus'
}

const EFFORT_BY_DIFFICULTY: Record<Difficulty, Effort> = {
  trivial: 'low',
  easy: 'low',
  moderate: 'medium',
  hard: 'high'
}

/**
 * Decide tier + effort for a unit of work. An explicit non-cascade tier wins
 * (blueprint authority); otherwise classify difficulty. priorFailures escalates
 * up the ladder — the validated rule is "escalate only when the cheap attempt was
 * externally judged to have failed", which the conductor enforces.
 */
export function route(input: RouteInput): RouteDecision {
  const difficulty = classifyDifficulty(input.instruction)
  let tier: Tier
  let rationale: string
  if (input.tier && input.tier !== 'cascade') {
    tier = input.tier
    rationale = `explicit tier ${tier} from plan`
  } else if (input.roleTier) {
    tier = input.roleTier
    rationale = `role default tier ${tier}`
  } else {
    tier = TIER_BY_DIFFICULTY[difficulty]
    rationale = `difficulty=${difficulty} → ${tier}`
  }
  const failures = Math.max(0, Math.floor(input.priorFailures ?? 0))
  for (let i = 0; i < failures; i++) tier = escalate(tier)
  if (failures > 0) rationale += `; escalated ${failures}× → ${tier}`
  return {
    tier,
    model: tier,
    effort: EFFORT_BY_DIFFICULTY[difficulty],
    difficulty,
    rationale
  }
}

/** A delegation tier hint from the `delegate` tool (docs/GOOSE_INTEGRATION.md). */
export type DelegateTier = 'free' | 'cheap' | 'auto'

/**
 * Pick which free/cheaper provider should handle a delegated subtask, or
 * undefined → caller should tell Claude "no suitable free provider; do it
 * yourself". Pure (no SDK/electron) so it is unit-testable via npm run selftest.
 *
 * Policy (a transparent default, not an oracle):
 *  - no enabled providers → undefined.
 *  - tier 'free' → first enabled `free` provider (else any enabled).
 *  - tier 'auto' → only delegate when the instruction looks trivial/easy; a
 *    'hard' classification returns undefined so Claude keeps hard work itself.
 *  - tier 'cheap' → any enabled provider regardless of difficulty.
 */
export function pickProvider(
  tier: DelegateTier,
  instruction: string,
  enabled: { id: string; free: boolean }[]
): string | undefined {
  return orderProviders(tier, instruction, enabled)[0]
}

/**
 * Ordered provider-id candidate list for a delegated subtask (free providers
 * first), for the quota/429 fallback loop: try each in turn until one succeeds.
 * Same gating as pickProvider. Pure → selftest-able.
 *  - no providers → [].
 *  - tier 'free'  → only free providers (strict; may be empty).
 *  - tier 'auto' + a 'hard' instruction → [] (Claude keeps hard work itself).
 *  - else → free providers first, then the rest (paid) as last-resort fallback.
 */
export function orderProviders(
  tier: DelegateTier,
  instruction: string,
  enabled: { id: string; free: boolean }[]
): string[] {
  if (!enabled.length) return []
  const free = enabled.filter((p) => p.free).map((p) => p.id)
  if (tier === 'free') return free
  if (tier === 'auto' && classifyDifficulty(instruction) === 'hard') return []
  const rest = enabled.filter((p) => !p.free).map((p) => p.id)
  return [...free, ...rest]
}

/**
 * Resolve a tier to a concrete model id from the live capability list (substring
 * match on value/displayName). Falls back to the alias, which the SDK also
 * accepts — this keeps Forge from hardcoding ids that drift between releases.
 */
export function resolveModelId(
  tier: Tier,
  models: { value: string; displayName?: string }[]
): string {
  const hit = models.find(
    (m) =>
      m.value.toLowerCase().includes(tier) ||
      (m.displayName ?? '').toLowerCase().includes(tier)
  )
  return hit?.value ?? tier
}
