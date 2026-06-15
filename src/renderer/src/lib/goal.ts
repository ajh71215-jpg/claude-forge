// Pure logic for the autonomous /goal loop (Forge's headless analog of the
// interactive Claude Code /goal). Extracted from Composer.tsx so it's testable in
// isolation; no React, no DOM. The Composer owns the loop's React state + the
// send wiring, but the directive text + the completion rule + the state shape
// live here.

/** Live state for the autonomous /goal loop: re-run the resumed session until the
 * model signals GOAL_ACHIEVED, an error, the iteration cap, or the budget. */
export interface GoalState {
  objective: string
  iter: number
  max: number
  /** USD spent across all iterations so far (sum of per-run result costs). */
  spent: number
  /** Cumulative USD cap — the loop hard-stops once `spent` reaches it. This is the
   * runaway guard the per-run maxBudgetUsd can't provide (it resets each run). */
  budget: number
}

/** Default cumulative USD ceiling for a /goal loop, used unless the user has set a
 * higher LIMITS "max $/run" (then that value is the goal's total budget). */
export const GOAL_MAX_USD = 10

/** Directive that turns one run into a goal-loop step. Injected as a prefix on the
 * user message (not the system prompt) so it doesn't bust the prompt cache; the
 * agent keeps all its real tools + the user's permission mode. */
export function goalDirective(objective: string): string {
  return [
    'GOAL MODE — autonomous objective loop.',
    `Objective: ${objective}`,
    'Work toward this objective using your available tools. This runs in a loop:' +
      ' after each turn you are automatically prompted to continue, so you need not' +
      ' finish everything at once — make concrete, verifiable progress each turn.',
    'At the VERY END of every response, output exactly one status token on its own line:',
    '- GOAL_ACHIEVED — only when the objective is fully complete AND verified' +
      ' (prefer running tests / build / typecheck to confirm before declaring done).',
    '- GOAL_CONTINUE — when more work remains; briefly state the next concrete step.',
    'Do not output GOAL_ACHIEVED prematurely.'
  ].join('\n')
}

/** Did the assistant's response declare the goal complete? Last token wins so a
 * response that discusses GOAL_CONTINUE earlier but ends with GOAL_ACHIEVED still
 * resolves correctly (and vice-versa). */
export function goalAchieved(text: string): boolean {
  const ach = text.lastIndexOf('GOAL_ACHIEVED')
  if (ach < 0) return false
  return ach > text.lastIndexOf('GOAL_CONTINUE')
}
