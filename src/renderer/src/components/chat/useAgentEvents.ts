// The live event-driven transcript state for CHAT (docs/MAINTAINABILITY.md
// Phase 2). Owns the turns/perms/dialogs/context state and the single streaming
// subscription, returning the bundle to Composer. The rAF coalescing is
// docs/PERFORMANCE.md lever 2 — the effect body is unchanged from App.tsx; do
// not alter without re-profiling.
import { useEffect, useState } from 'react'
import type { AgentEvent, DialogReq, PermReq, Turn } from '../../types'
import { reduceBlocks } from '../../lib/blocks'

/** Live reliability signals shown as a non-intrusive banner over the composer. */
export interface Reliability {
  retry?: { attempt: number; max: number; status?: number | null }
  rate?: { status: string; utilization?: number; rateLimitType?: string; resetsAt?: number }
  compact?: { trigger: string; pre?: number; post?: number }
}

/** Payload Composer forwards to MainShell on a successful result. */
export interface AgentResultPayload {
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  /** cache_creation_input_tokens — the write side of prompt caching, surfaced in
   * the TOKENS panel (docs/TOKEN_OPTIMIZATION.md §3 lever 1). */
  cacheWriteTokens?: number
  contextTokens?: number
}

/**
 * Refs Composer owns and the subscription reads. Typed structurally (`{ current }`)
 * so both MutableRefObject (useRef(value)) and RefObject (useRef<T>(null)) satisfy
 * them without friction — the hook only ever reads `.current`.
 */
export interface AgentEventRefs {
  /** runIds this Composer started — events for other views (Squad) are ignored. */
  ownedRef: { readonly current: Set<string> }
  /** the in-flight runId (foreground) — distinguishes it from background runs. */
  runIdRef: { readonly current: string | null }
  onSessionRef: { readonly current: (id: string) => void }
  onResultRef: { readonly current: (r: AgentResultPayload) => void }
  taRef: { readonly current: HTMLTextAreaElement | null }
}

/**
 * Subscribe once and route streaming events to the matching turn. Returns the
 * live transcript state + setters so Composer can read/render them and mutate
 * them from its own handlers (send / compact / session-restore).
 */
export function useAgentEvents(refs: AgentEventRefs): {
  turns: Turn[]
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>
  perms: PermReq[]
  setPerms: React.Dispatch<React.SetStateAction<PermReq[]>>
  dialogs: DialogReq[]
  setDialogs: React.Dispatch<React.SetStateAction<DialogReq[]>>
  contextTokens: number
  setContextTokens: React.Dispatch<React.SetStateAction<number>>
  contextModel: string
  setContextModel: React.Dispatch<React.SetStateAction<string>>
  reliability: Reliability | null
  setReliability: React.Dispatch<React.SetStateAction<Reliability | null>>
} {
  const { ownedRef, runIdRef, onSessionRef, onResultRef, taRef } = refs
  const [turns, setTurns] = useState<Turn[]>([])
  const [perms, setPerms] = useState<PermReq[]>([])
  const [dialogs, setDialogs] = useState<DialogReq[]>([])
  const [contextTokens, setContextTokens] = useState(0)
  const [contextModel, setContextModel] = useState('')
  // Reliability awareness: API retries, subscription rate limits and auto-compaction
  // — all from events the SDK already streams (no extra tokens). Surfaced so a pause
  // reads as "retrying / rate-limited" instead of a frozen UI.
  const [reliability, setReliability] = useState<Reliability | null>(null)

  // Subscribe once; route streaming events to the matching turn. Ignore events
  // that belong to other views (e.g. Squad runs) so usage isn't double-counted.
  useEffect(() => {
    // Coalesce streaming block events into one state flush per animation frame
    // (rAF batching): hundreds of token deltas collapse to ~60 renders/sec.
    // docs/PERFORMANCE.md lever 2. Buffer + raf live for the effect's lifetime.
    const pending: AgentEvent[] = []
    let raf: number | null = null
    const flush = (): void => {
      raf = null
      if (!pending.length) return
      const evs = pending.splice(0)
      setTurns((prev) =>
        prev.map((t) => {
          let blocks = t.blocks
          let changed = false
          for (const e of evs) {
            if (e.runId !== t.id) continue
            const next = reduceBlocks(blocks, e)
            if (next !== blocks) {
              blocks = next
              changed = true
            }
          }
          return changed ? { ...t, blocks } : t
        })
      )
    }
    const unsub = window.forge.agent.onEvent((ev) => {
      if (!ownedRef.current.has(ev.runId)) return
      if (ev.type === 'session') {
        if (ev.runId === runIdRef.current) onSessionRef.current(ev.sessionId)
        return
      }
      if (ev.type === 'system') {
        if (ev.model) setContextModel(ev.model)
        return
      }
      if (ev.type === 'api-retry') {
        setReliability((r) => ({
          ...r,
          retry: { attempt: ev.attempt, max: ev.maxRetries, status: ev.errorStatus }
        }))
        return
      }
      if (ev.type === 'rate-limit') {
        setReliability((r) =>
          ev.status === 'allowed'
            ? r?.rate
              ? { ...r, rate: undefined }
              : r
            : {
                ...r,
                rate: {
                  status: ev.status,
                  utilization: ev.utilization,
                  rateLimitType: ev.rateLimitType,
                  resetsAt: ev.resetsAt
                }
              }
        )
        return
      }
      if (ev.type === 'compact-boundary') {
        setReliability((r) => ({
          ...r,
          compact: { trigger: ev.trigger, pre: ev.preTokens, post: ev.postTokens }
        }))
        return
      }
      // Content resumed → a retry (if any) succeeded; clear the transient note.
      if (ev.type === 'block-start') {
        setReliability((r) => (r?.retry ? { ...r, retry: undefined } : r))
      }
      if (ev.type === 'permission') {
        if (ev.runId === runIdRef.current) {
          setPerms((prev) => [...prev, { id: ev.id, toolName: ev.toolName, input: ev.input }])
        }
        return
      }
      if (ev.type === 'dialog') {
        if (ev.dialogKind === 'permission_ask_user_question' && ev.runId === runIdRef.current) {
          setDialogs((prev) => [
            ...prev,
            { id: ev.id, dialogKind: ev.dialogKind, payload: ev.payload, toolUseID: ev.toolUseID }
          ])
        } else {
          // Unknown kind or background run — deny so the subprocess proceeds.
          window.forge.agent.respondDialog(ev.id, {
            behavior: 'deny',
            message: 'Not answerable here'
          })
        }
        return
      }
      if (ev.type === 'result') {
        flush() // apply any buffered deltas before marking the turn complete
        setTurns((prev) =>
          prev.map((t) =>
            t.id === ev.runId
              ? {
                  ...t,
                  running: false,
                  meta: { costUsd: ev.costUsd, durationMs: ev.durationMs, error: ev.error }
                }
              : t
          )
        )
        if (ev.runId === runIdRef.current) {
          setPerms([])
          setDialogs([])
          taRef.current?.focus()
          // Drop transient notes (retry/compact); a rate-limit warning is
          // account-level so it persists until the next rate-limit update.
          setReliability((r) => (r?.rate ? { rate: r.rate } : null))
        }
        if (typeof ev.contextTokens === 'number') setContextTokens(ev.contextTokens)
        if (ev.ok) {
          onResultRef.current({
            costUsd: ev.costUsd,
            inputTokens: ev.inputTokens,
            outputTokens: ev.outputTokens,
            cacheReadTokens: ev.cacheReadTokens,
            cacheWriteTokens: ev.cacheWriteTokens,
            contextTokens: ev.contextTokens
          })
        }
        return
      }
      // block-start / block-delta / tool-input / tool-result — buffer + rAF flush
      pending.push(ev)
      if (raf == null) raf = requestAnimationFrame(flush)
    })
    return () => {
      if (raf != null) cancelAnimationFrame(raf)
      unsub()
    }
    // Subscribe exactly once; the refs are stable (useRef) and read live via
    // `.current`, so they intentionally aren't deps (re-subscribing would drop events).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    turns,
    setTurns,
    perms,
    setPerms,
    dialogs,
    setDialogs,
    contextTokens,
    setContextTokens,
    contextModel,
    setContextModel,
    reliability,
    setReliability
  }
}
