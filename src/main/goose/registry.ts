// Live goose-process registry + concurrency cap (docs/GOOSE_INTEGRATION.md).
//
// Two jobs, both dependency-free (no electron/SDK import):
//  1. Track active goose ACP clients per main-run id, so STOP/interrupt (and
//     window-close) can kill in-flight delegated subtasks instead of letting them
//     run to goose's 300s timeout (orphan processes + wasted free-tier calls).
//  2. Cap concurrent goose processes — Claude may fire several delegate(...) calls
//     in parallel; without a cap that spawns N heavy Rust processes at once.

interface Killable {
  shutdown(): void
}

const byRun = new Map<string, Set<Killable>>()

export function registerGooseClient(runId: string, client: Killable): void {
  let set = byRun.get(runId)
  if (!set) {
    set = new Set()
    byRun.set(runId, set)
  }
  set.add(client)
}

export function unregisterGooseClient(runId: string, client: Killable): void {
  const set = byRun.get(runId)
  if (!set) return
  set.delete(client)
  if (set.size === 0) byRun.delete(runId)
}

/** Kill every goose client spawned for a run (called from interruptRun). */
export function killGooseForRun(runId: string): void {
  const set = byRun.get(runId)
  if (!set) return
  for (const c of set) {
    try {
      c.shutdown()
    } catch {
      /* already gone */
    }
  }
  byRun.delete(runId)
}

// ── Concurrency semaphore ──
const MAX_CONCURRENT = Number(process.env.FORGE_GOOSE_MAX_CONCURRENT) || 3
let inFlight = 0
const waiters: (() => void)[] = []

/** Acquire a goose slot (resolves when one is free). */
export function acquireGooseSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => waiters.push(resolve))
}

/** Release a goose slot, waking the next waiter. */
export function releaseGooseSlot(): void {
  const next = waiters.shift()
  if (next) next()
  else inFlight = Math.max(0, inFlight - 1)
}
