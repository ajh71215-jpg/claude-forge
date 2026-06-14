// Orchestration IPC (docs/SQUAD_ORCHESTRATION.md). Two channels drive ONE engine
// (real conductor + topology + budget governor); they differ ONLY in the injected
// runner/verifier:
//   • dry-run → SIMULATED no-model samples — proves renderer ↔ main ↔ conductor
//     end-to-end WITHOUT a subscription.
//   • run     → LIVE adapter (§6, the last live-gated piece): each sample is a real
//     read-only `runSubtaskQuery` SDK call routed to its cascade tier; each verdict
//     is a cheap haiku rubric judge. Folds judge cost into the artifact so the
//     budget governor stays honest.

import type { IpcMain, WebContents } from 'electron'
import type { Artifact, Plan, Subtask, Verdict } from '../orchestration'
import type { ConductorEvent } from '../conductor'
import type { SampleRunner, SampleVerifier } from '../topology'
import { executePlan, validatePlan } from '../conductor'
import { executeTopology } from '../topology'
import { runSubtaskQuery } from '../agent/subtaskRunner'

export type OrchestrateEvent =
  | { runId: string; kind: 'conductor'; event: ConductorEvent }
  | { runId: string; kind: 'sample'; subtaskId: string; sample: number; tier: string }
  | { runId: string; kind: 'done'; spentUsd: number; stopped?: string; artifacts: number }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type RunnerFactory = (blackboard: Map<string, Artifact>) => SampleRunner
type VerifierFactory = (blackboard: Map<string, Artifact>) => SampleVerifier

interface RunResult {
  ok: boolean
  errors: string[]
  spentUsd: number
  stopped?: string
}

/**
 * Shared streaming executor: validates the plan, runs the REAL conductor/topology
 * engine with the injected per-run runner+verifier, and streams ConductorEvents to
 * the Squad-tab Blackboard monitor. dry-run and live differ only in what they pass.
 */
async function streamExecute(
  sender: WebContents,
  runId: string,
  plan: Plan,
  makeRun: RunnerFactory,
  makeVerify: VerifierFactory,
  projectCostUsd: () => number
): Promise<RunResult> {
  const send = (ev: Record<string, unknown>): void => {
    if (!sender.isDestroyed()) sender.send('orchestrate:event', { runId, ...ev })
  }

  const validation = validatePlan(plan)
  if (!validation.ok) {
    send({ kind: 'done', spentUsd: 0, stopped: 'invalid-plan', artifacts: 0 })
    return { ok: false, errors: validation.errors, spentUsd: 0, stopped: 'invalid-plan' }
  }

  const result = await executePlan(plan, {
    maxRevisions: 1,
    projectCostUsd,
    onEvent: (event) => send({ kind: 'conductor', event }),
    // Each subtask runs its declared topology; the topology engine fans the
    // run/verify out per sample. The blackboard is closed over so live runs can
    // feed prior outputs in as read-only context.
    runSubtask: async (st, _attempt, blackboard) => {
      const topo = await executeTopology(st, {
        run: makeRun(blackboard),
        verify: makeVerify(blackboard)
      })
      return topo.artifact
    },
    // The topology already attached a verdict; the conductor honors it.
    verify: async (st, art) =>
      art.verdict ?? {
        subtaskId: st.id,
        pass: true,
        score: 1,
        confidence: 1,
        rationale: 'ok',
        evidence: []
      }
  })

  send({
    kind: 'done',
    spentUsd: result.spentUsd,
    stopped: result.stopped,
    artifacts: result.artifacts.length
  })
  return { ok: true, errors: [], spentUsd: result.spentUsd, stopped: result.stopped }
}

// ---------------------------------------------------------------------------
// DRY-RUN: deterministic no-model samples.
// ---------------------------------------------------------------------------
function dryRun(sender: WebContents, runId: string, plan: Plan): Promise<RunResult> {
  const send = (ev: Record<string, unknown>): void => {
    if (!sender.isDestroyed()) sender.send('orchestrate:event', { runId, ...ev })
  }
  const makeRun: RunnerFactory = () => async (s, ctx) => {
    send({ kind: 'sample', subtaskId: s.id, sample: ctx.sample, tier: ctx.tier })
    await sleep(280)
    return { subtaskId: s.id, output: `[dry-run ${ctx.tier}] ${s.instruction}`, costUsd: 0.01 }
  }
  const makeVerify: VerifierFactory = () => async (s, art) => {
    await sleep(160)
    // Deterministic no-model policy: cascade subtasks "pass" only once they reach
    // opus (so the monitor visibly shows tier escalation); all others pass first.
    const tier = (art.output.match(/\[dry-run (\w+)\]/) || [])[1] || 'sonnet'
    const pass = s.topology === 'cascade' ? tier === 'opus' : true
    return {
      subtaskId: s.id,
      pass,
      score: pass ? 1 : 0.4,
      confidence: 0.9,
      rationale: pass ? 'dry-run checks passed' : 'dry-run: escalate tier',
      evidence: [`tier=${tier}`]
    }
  }
  return streamExecute(sender, runId, plan, makeRun, makeVerify, () => 0.01)
}

// ---------------------------------------------------------------------------
// LIVE: real SDK calls (read-only) + cheap haiku rubric judge.
// ---------------------------------------------------------------------------
const blackboardContext = (bb: Map<string, Artifact>): string | undefined => {
  const parts = [...bb.values()].map((a) => `[${a.subtaskId}] ${a.output}`)
  return parts.length ? parts.join('\n\n') : undefined
}

/** Parse the haiku judge's single-line verdict. Lenient: defaults to fail. */
function parseJudge(subtaskId: string, text: string, judgeCost: number): Verdict {
  const pass = /VERDICT:\s*PASS/i.test(text)
  const m = text.match(/score\s*=?\s*([01](?:\.\d+)?)/i)
  const score = m ? Math.min(1, Math.max(0, parseFloat(m[1]))) : pass ? 1 : 0
  return {
    subtaskId,
    pass,
    score,
    confidence: 0.6,
    // Honest: this is an LLM judge (docs §3 prefers tool oracles WHEN APPLICABLE;
    // read-only text subtasks produce no toolchain artifact to check).
    rationale: `model-judge(haiku): ${text.replace(/\s+/g, ' ').trim().slice(0, 160)}`,
    evidence: [`judge=haiku`, `judgeCostUsd=${judgeCost.toFixed(4)}`]
  }
}

function liveRun(sender: WebContents, runId: string, plan: Plan): Promise<RunResult> {
  const send = (ev: Record<string, unknown>): void => {
    if (!sender.isDestroyed()) sender.send('orchestrate:event', { runId, ...ev })
  }

  const makeRun: RunnerFactory = (blackboard) => async (s, ctx) => {
    send({ kind: 'sample', subtaskId: s.id, sample: ctx.sample, tier: ctx.tier })
    try {
      const r = await runSubtaskQuery({
        instruction: s.instruction,
        model: ctx.tier, // 'haiku' | 'sonnet' | 'opus' — SDK accepts the alias
        context: blackboardContext(blackboard),
        maxTurns: s.maxTurns
      })
      return { subtaskId: s.id, output: r.output || '(empty response)', costUsd: r.costUsd }
    } catch (e) {
      return {
        subtaskId: s.id,
        output: `ERROR: ${e instanceof Error ? e.message : String(e)}`,
        costUsd: 0
      }
    }
  }

  const makeVerify: VerifierFactory = () => async (s, art) => {
    const prompt =
      `You are a strict verifier judging whether a subtask's output meets its rubric.\n` +
      `SUBTASK: ${s.instruction}\n` +
      `RUBRIC (success criteria): ${s.rubric}\n` +
      `OUTPUT TO JUDGE:\n${art.output}\n` +
      `---\nReply with EXACTLY one line and nothing else:\n` +
      `VERDICT: PASS score=<0..1> — <≤10-word reason>\n` +
      `or\nVERDICT: FAIL score=<0..1> — <≤10-word reason>`
    try {
      const r = await runSubtaskQuery({ instruction: prompt, model: 'haiku', maxTurns: 1 })
      art.costUsd += r.costUsd // fold judge cost in → budget governor stays honest
      return parseJudge(s.id, r.output, r.costUsd)
    } catch (e) {
      return {
        subtaskId: s.id,
        pass: false,
        score: 0,
        confidence: 0.3,
        rationale: `judge error: ${e instanceof Error ? e.message : String(e)}`,
        evidence: ['judge=haiku', 'error']
      }
    }
  }

  // Live calls cost real money; project a per-subtask estimate so the budget
  // governor can hard-stop BEFORE overrunning plan.budgetUsd.
  return streamExecute(sender, runId, plan, makeRun, makeVerify, () => 0.15)
}

export function register(ipc: IpcMain): void {
  // Dry-run the orchestration engine (no model) → live events on 'orchestrate:event'.
  ipc.handle('orchestrate:dry-run', (e, runId: string, plan: Plan) => dryRun(e.sender, runId, plan))
  // LIVE run: real read-only SDK calls + haiku judge (needs a Claude session).
  ipc.handle('orchestrate:run', (e, runId: string, plan: Plan) => liveRun(e.sender, runId, plan))
  // Plan validation gate, exposed for the editor's inline feedback.
  ipc.handle('orchestrate:validate', (_e, plan: Plan) => validatePlan(plan))
}

// Subtask type re-exported for callers that build plans inline.
export type { Subtask }
