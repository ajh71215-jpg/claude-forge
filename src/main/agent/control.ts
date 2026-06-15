// Live run controls (docs/MAINTAINABILITY.md Phase 4). Extracted verbatim from
// the former src/main/agent.ts. These drain the shared run-state maps that
// runStreaming fills.

import { active, pendingDialogs, pendingPerms } from './state'
import type { QuestionResult } from './types'
import { killGooseForRun } from '../goose/registry'

/** Resolve a pending ASK prompt with the renderer's decision. */
export function respondPermission(id: string, allow: boolean): void {
  const resolve = pendingPerms.get(id)
  if (resolve) {
    pendingPerms.delete(id)
    resolve(allow ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied in Forge' })
  }
}

/** Resolve a pending AskUserQuestion prompt with the renderer's answer. */
export function respondDialog(id: string, result: QuestionResult): void {
  const resolve = pendingDialogs.get(id)
  if (resolve) {
    pendingDialogs.delete(id)
    resolve(result)
  }
}

/** STOP — interrupt the active run and kill any goose subtasks it delegated. */
export async function interruptRun(runId: string): Promise<void> {
  // Kill in-flight delegated goose processes first (no ACP cancel exists, and
  // they'd otherwise run to goose's 300s timeout after the run is interrupted).
  killGooseForRun(runId)
  const q = active.get(runId)
  if (q) {
    try {
      await q.interrupt()
    } catch {
      /* already finishing */
    }
  }
}

/** Interrupt EVERY in-flight run — called on window-close / app-quit so a closing
 * window can't leave an SDK subprocess streaming (and billing) in the background
 * (notably on macOS, where closing the last window doesn't quit the app). */
export async function interruptAll(): Promise<void> {
  await Promise.all([...active.keys()].map((id) => interruptRun(id)))
}
