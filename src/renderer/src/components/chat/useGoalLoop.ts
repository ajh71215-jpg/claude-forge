// The autonomous /goal loop's React state + driver, extracted from Composer.tsx
// (behavior-preserving). Owns the goal state + the loop effect that, when a goal
// run finishes, reads the assistant's status token and either stops (achieved /
// error / iteration cap / cumulative budget) or auto-sends a continuation. The
// Composer keeps `send` (reads goalRef for the directive prefix); this drives it
// via sendRef. The directive text + completion rule live in lib/goal.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Turn } from '../../types'
import { goalAchieved, GOAL_MAX_USD, type GoalState } from '../../lib/goal'

export interface GoalLoop {
  goal: GoalState | null
  /** Synchronous mirror of the goal state — read by send() to build the directive. */
  goalRef: { readonly current: GoalState | null }
  startGoal: (objective: string, max: number) => void
  /** Banner stop button: clear + interrupt + notice. */
  stopGoal: () => void
  /** Clear silently (session switch / manual STOP). */
  resetGoal: () => void
}

export function useGoalLoop(opts: {
  turns: Turn[]
  running: boolean
  runIdRef: { readonly current: string | null }
  maxBudget: number
  sendRef: { readonly current: ((textArg?: string) => Promise<void>) | undefined }
  pushNotice: (cmd: string, msg: string) => void
}): GoalLoop {
  const { turns, running, runIdRef, maxBudget, sendRef, pushNotice } = opts
  const [goal, setGoalState] = useState<GoalState | null>(null)
  const goalRef = useRef<GoalState | null>(null)
  const setGoal = useCallback((g: GoalState | null): void => {
    goalRef.current = g
    setGoalState(g)
  }, [])
  const processedTurnRef = useRef<string | null>(null)

  const startGoal = useCallback(
    (objective: string, max: number): void => {
      // Cumulative budget: the user's "max $/run" if set (treated as the goal
      // total), else a conservative default — the dollar runaway guard.
      const budget = Math.max(GOAL_MAX_USD, maxBudget)
      setGoal({ objective, iter: 1, max, spent: 0, budget })
      processedTurnRef.current = null
      pushNotice(
        '🎯 /goal',
        `Goal set — running autonomously until complete (max ${max} iteration${max === 1 ? '' : 's'} · budget $${budget.toFixed(0)}).\n\nObjective: ${objective}`
      )
      void sendRef.current?.(objective)
    },
    [maxBudget, pushNotice, sendRef, setGoal]
  )

  const stopGoal = useCallback((): void => {
    const g = goalRef.current
    setGoal(null)
    if (runIdRef.current) void window.forge.agent.interrupt(runIdRef.current)
    if (g) pushNotice('🎯 /goal', `Goal stopped after ${g.iter} iteration${g.iter === 1 ? '' : 's'}.`)
  }, [pushNotice, runIdRef, setGoal])

  const resetGoal = useCallback((): void => {
    setGoal(null)
    processedTurnRef.current = null
  }, [setGoal])

  // Drive the loop: when a goal run finishes, decide stop vs. continue.
  useEffect(() => {
    const g = goalRef.current
    if (!g || running) return
    const last = turns[turns.length - 1]
    if (!last || last.running) return
    if (processedTurnRef.current === last.id) return
    processedTurnRef.current = last.id

    // Accumulate the cost of the run that just finished (runaway-budget guard).
    const spent = g.spent + (last.meta?.costUsd ?? 0)

    if (last.meta?.error) {
      setGoal(null)
      pushNotice('🎯 /goal', `Goal stopped — the last run errored: ${last.meta.error}`)
      return
    }
    const answer = last.blocks
      .filter((b): b is Extract<typeof b, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n')
    if (goalAchieved(answer)) {
      setGoal(null)
      pushNotice(
        '🎯 /goal',
        `✓ Goal achieved in ${g.iter} iteration${g.iter === 1 ? '' : 's'} ($${spent.toFixed(2)}).`
      )
      return
    }
    if (spent >= g.budget) {
      setGoal(null)
      pushNotice(
        '🎯 /goal',
        `Reached the $${g.budget.toFixed(0)} budget ($${spent.toFixed(2)} spent) without GOAL_ACHIEVED. Stopping — raise "max $/run" in LIMITS and run /goal again to continue.`
      )
      return
    }
    if (g.iter >= g.max) {
      setGoal(null)
      pushNotice(
        '🎯 /goal',
        `Reached the ${g.max}-iteration cap ($${spent.toFixed(2)} spent) without GOAL_ACHIEVED. Stopping — run /goal again to keep going.`
      )
      return
    }
    setGoal({ ...g, iter: g.iter + 1, spent })
    void sendRef.current?.(
      'Continue working toward the goal. Make concrete progress, verify it, and remember to end with GOAL_ACHIEVED or GOAL_CONTINUE on its own line.'
    )
    // setGoal/pushNotice/sendRef are stable enough; re-run only when the transcript
    // or running flag changes — exactly what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, running])

  return { goal, goalRef, startGoal, stopGoal, resetGoal }
}
