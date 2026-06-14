// Orchestration IPC (docs/SQUAD_ORCHESTRATION.md). The DRY-RUN channel executes
// the REAL conductor + topology engine with SIMULATED (no-model) sample runners,
// streaming live ConductorEvents to the Squad-tab Blackboard monitor. This proves
// the renderer ↔ main ↔ conductor pipeline end-to-end WITHOUT a subscription — the
// only live-gated piece is swapping the simulated runner for a real SDK call.

import type { IpcMain, WebContents } from 'electron'
import type { Plan } from '../orchestration'
import type { ConductorEvent } from '../conductor'
import { executePlan, validatePlan } from '../conductor'
import { executeTopology } from '../topology'

export type OrchestrateEvent =
  | { runId: string; kind: 'conductor'; event: ConductorEvent }
  | { runId: string; kind: 'sample'; subtaskId: string; sample: number; tier: string }
  | { runId: string; kind: 'done'; spentUsd: number; stopped?: string; artifacts: number }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function dryRun(
  sender: WebContents,
  runId: string,
  plan: Plan
): Promise<{ ok: boolean; errors: string[]; spentUsd: number; stopped?: string }> {
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
    projectCostUsd: () => 0.01,
    onEvent: (event) => send({ kind: 'conductor', event }),
    // Each subtask runs its declared topology with SIMULATED samples.
    runSubtask: async (st) => {
      const topo = await executeTopology(st, {
        run: async (s, ctx) => {
          send({ kind: 'sample', subtaskId: s.id, sample: ctx.sample, tier: ctx.tier })
          await sleep(280)
          return { subtaskId: s.id, output: `[dry-run ${ctx.tier}] ${s.instruction}`, costUsd: 0.01 }
        },
        verify: async (s, art) => {
          await sleep(160)
          // Deterministic no-model policy: cascade subtasks "pass" only once they
          // reach opus (so the monitor visibly shows tier escalation); all others
          // pass on the first sample.
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

  send({ kind: 'done', spentUsd: result.spentUsd, stopped: result.stopped, artifacts: result.artifacts.length })
  return { ok: true, errors: [], spentUsd: result.spentUsd, stopped: result.stopped }
}

export function register(ipc: IpcMain): void {
  // Dry-run the orchestration engine (no model) → live events on 'orchestrate:event'.
  ipc.handle('orchestrate:dry-run', (e, runId: string, plan: Plan) => dryRun(e.sender, runId, plan))
  // Plan validation gate, exposed for the editor's inline feedback.
  ipc.handle('orchestrate:validate', (_e, plan: Plan) => validatePlan(plan))
}
