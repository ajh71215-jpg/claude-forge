// Live debug event stream — zero extra tokens.
// Subscribes to the already-flowing `agent:event` IPC channel (same one
// Composer uses for chat rendering) and accumulates full per-run debug state:
// thinking content, tool input JSON, tool result output. This is data the
// agent emits anyway; Forge just wasn't collecting it for the debug UI before.
//
// Architecture: module-level singleton store so multiple components (SquadView,
// DebugSidePanel) share a single subscription and never miss events even when
// one component is unmounted. The store starts collecting as soon as the first
// component calls useDebugStream() — typically MainShell on login.

import { useEffect, useRef, useState } from 'react'
import type { AgentEvent } from '../types'

// ── Types ────────────────────────────────────────────────────────────────────

export interface DebugEntry {
  /** Matches the SDK blockId so we can correlate delta events. */
  blockId: string
  kind: 'thinking' | 'text' | 'tool'
  /** Accumulated streaming text (thinking) or response text (text). */
  text: string
  /** Tool name, for kind === 'tool'. */
  name?: string
  /** SDK tool_use id, for kind === 'tool'. */
  toolId?: string
  /** Accumulated tool input JSON (streamed via tool-input events). */
  inputJson: string
  /** Tool result content string (from tool-result event). */
  resultText?: string
  resultOk?: boolean
  status: 'running' | 'ok' | 'error'
  startedAt: number
  endedAt?: number
  /** When set, this tool was run by a subagent (not the lead). */
  parentToolId?: string | null
}

export interface DebugRun {
  runId: string
  entries: DebugEntry[]
  isLive: boolean
  startedAt: number
  /** Duration in ms (from SDK result event). */
  totalMs?: number
  costUsd?: number
  error?: string
}

// ── Module-level singleton store ─────────────────────────────────────────────

const MAX_RUNS = 10 // keep last 10 runs in memory

const store = {
  /** runId → DebugRun (newest runs, capped at MAX_RUNS). */
  runs: new Map<string, DebugRun>(),
  /** runId insertion order — oldest first, so we know what to evict. */
  order: [] as string[],
  /** currentRunId = most recently started run. */
  currentRunId: null as string | null,
  /** Components using this hook; each gets notified when data changes. */
  listeners: new Set<() => void>(),
  /** True once the IPC subscription is active. */
  subscribed: false,
  /** The cleanup fn returned by window.forge.agent.onEvent. */
  unsub: null as (() => void) | null
}

function ensureRun(runId: string): DebugRun {
  if (!store.runs.has(runId)) {
    if (store.order.length >= MAX_RUNS) {
      const oldest = store.order.shift()!
      store.runs.delete(oldest)
    }
    store.order.push(runId)
    store.currentRunId = runId
    store.runs.set(runId, {
      runId,
      entries: [],
      isLive: true,
      startedAt: Date.now()
    })
  }
  return store.runs.get(runId)!
}

function findEntry(run: DebugRun, blockId: string): DebugEntry | undefined {
  // Scan in reverse — most recent block matches first (same blockId shouldn't
  // repeat, but guard against edge cases).
  for (let i = run.entries.length - 1; i >= 0; i--) {
    if (run.entries[i].blockId === blockId) return run.entries[i]
  }
  return undefined
}

function findEntryByToolId(run: DebugRun, toolId: string): DebugEntry | undefined {
  for (let i = run.entries.length - 1; i >= 0; i--) {
    if (run.entries[i].toolId === toolId) return run.entries[i]
  }
  return undefined
}

let flushTimer: number | null = null
function scheduleFlush(): void {
  if (flushTimer != null) return
  flushTimer = window.requestAnimationFrame(() => {
    flushTimer = null
    for (const cb of store.listeners) cb()
  })
}

function handleEvent(ev: AgentEvent): void {
  const { runId } = ev

  // Lazily create a run entry on first meaningful event.
  if (ev.type === 'result' && !store.runs.has(runId)) return

  switch (ev.type) {
    case 'block-start': {
      if (ev.kind !== 'thinking' && ev.kind !== 'text' && ev.kind !== 'tool') break
      const run = ensureRun(runId)
      run.entries.push({
        blockId: ev.blockId,
        kind: ev.kind,
        text: '',
        name: ev.name,
        toolId: ev.toolId ?? undefined,
        inputJson: '',
        status: 'running',
        startedAt: Date.now(),
        parentToolId: ev.parentToolId ?? null
      })
      scheduleFlush()
      break
    }
    case 'block-delta': {
      const run = store.runs.get(runId)
      if (!run) break
      const e = findEntry(run, ev.blockId)
      if (e) e.text += ev.text
      scheduleFlush()
      break
    }
    case 'block-stop': {
      const run = store.runs.get(runId)
      if (!run) break
      const e = findEntry(run, ev.blockId)
      if (e && e.kind !== 'tool') {
        e.status = 'ok'
        e.endedAt = Date.now()
      }
      scheduleFlush()
      break
    }
    case 'tool-input': {
      const run = store.runs.get(runId)
      if (!run) break
      const e = findEntry(run, ev.blockId)
      if (e) e.inputJson += ev.partialJson
      scheduleFlush()
      break
    }
    case 'tool-result': {
      const run = store.runs.get(runId)
      if (!run) break
      const e = findEntryByToolId(run, ev.toolId)
      if (e) {
        e.status = ev.ok ? 'ok' : 'error'
        e.resultText = ev.content
        e.resultOk = ev.ok
        e.endedAt = Date.now()
      }
      scheduleFlush()
      break
    }
    case 'result': {
      const run = store.runs.get(runId)
      if (!run) break
      run.isLive = false
      run.costUsd = ev.costUsd
      run.error = ev.error
      run.totalMs = ev.durationMs
      // If this was the current run, keep it so the panel can show the final state.
      scheduleFlush()
      break
    }
    default:
      break
  }
}

/** Subscribe to agent events once. Idempotent — safe to call multiple times. */
function ensureSubscribed(): void {
  if (store.subscribed) return
  store.subscribed = true
  store.unsub = window.forge.agent.onEvent(handleEvent)
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface DebugStreamResult {
  /** All collected runs, keyed by runId. Mutated in place; read fresh each render. */
  runs: Map<string, DebugRun>
  /** The most recently started runId, or null if no runs yet. */
  currentRunId: string | null
}

/**
 * Subscribe to the live debug event stream. Zero extra tokens — reads from the
 * same IPC stream the chat transcript uses.
 *
 * The first call starts the global IPC subscription; subsequent calls (from
 * other components) share the same subscription. The subscription lives as long
 * as the app is open — intentionally never cleaned up so background runs are
 * captured even when all subscribers have unmounted.
 */
export function useDebugStream(): DebugStreamResult {
  const [, setTick] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    // Start the global subscription (idempotent).
    ensureSubscribed()

    // Register a per-component RAF re-render trigger.
    function notify(): void {
      if (rafRef.current != null) return
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null
        setTick((n) => n + 1)
      })
    }
    store.listeners.add(notify)

    return () => {
      store.listeners.delete(notify)
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  return { runs: store.runs, currentRunId: store.currentRunId }
}
