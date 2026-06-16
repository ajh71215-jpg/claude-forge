// Context compaction for the composer: the manual /compact + the live progress
// bar + opt-in auto-compact at 80% context. Extracted from Composer.tsx
// (behavior-preserving).
import { useEffect, useRef, useState } from 'react'
import { ctxWindow } from '../../lib/format'

export interface Compaction {
  compacting: boolean
  compactPct: number
  compact: () => Promise<void>
}

export function useCompaction(opts: {
  sessionIdRef: { readonly current: string | null }
  onSessionRef: { readonly current: (id: string) => void }
  pushNotice: (cmd: string, msg: string) => void
  setContextTokens: (n: number) => void
  autoCompact: boolean
  running: boolean
  contextTokens: number
  contextModel: string
  /** Isolated workspace id for this conversation. /compact must resume in the
   * same cwd the session was created in, so this is threaded to the main process. */
  workspaceId?: string
}): Compaction {
  const {
    sessionIdRef,
    onSessionRef,
    pushNotice,
    setContextTokens,
    autoCompact,
    running,
    contextTokens,
    contextModel,
    workspaceId
  } = opts
  const [compacting, setCompacting] = useState(false)
  const [compactPct, setCompactPct] = useState(0)
  // Settle timer that resets the bar to 0 after a compact completes. Tracked so
  // we can cancel it on unmount (otherwise it fires setState on an unmounted
  // component when the tab is closed within 600ms of a compact finishing).
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (settleRef.current) clearTimeout(settleRef.current)
    },
    []
  )

  // Live /compact progress. The IPC is broadcast to every mounted tab, so filter
  // on this conversation's session id (otherwise one tab's compact moves all bars).
  useEffect(() => {
    const unsub = window.forge.agent.onCompactProgress((p) => {
      if (p.sessionId === sessionIdRef.current) setCompactPct(p.pct)
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function compact(): Promise<void> {
    const sid = sessionIdRef.current
    if (!sid || compacting || running) return
    setCompacting(true)
    setCompactPct(0)
    try {
      const r = await window.forge.agent.compact(sid, workspaceId)
      if (r.ok) {
        onSessionRef.current(r.sessionId)
        pushNotice('⟲ /compact', '✓ Context compacted — older messages summarized.')
        setContextTokens(0)
      } else {
        pushNotice('⟲ /compact', `Compact failed${r.error ? ': ' + r.error : ''}`)
      }
    } catch (e) {
      // The IPC call itself rejected (dead channel / main-process throw). Surface
      // it instead of leaking an unhandled rejection — auto-compact calls this
      // fire-and-forget, so without this catch the rejection escapes entirely.
      pushNotice('⟲ /compact', `Compact failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setCompacting(false)
      // Brief settle so the bar visibly reaches 100% before it disappears.
      if (settleRef.current) clearTimeout(settleRef.current)
      settleRef.current = setTimeout(() => setCompactPct(0), 600)
    }
  }

  // Auto-compact when context crosses 80% (opt-in via the LIMITS toggle). Depends
  // on contextModel too: the 80% threshold is a fraction of THAT model's context
  // window, so a mid-session model switch must re-evaluate it — a stale model
  // mis-sizes the window (e.g. compacting at 160k on a 1M model, or never on a
  // 200k one). compact() is fire-and-forget but guards its own errors internally.
  useEffect(() => {
    if (!autoCompact || compacting || running || !sessionIdRef.current || contextTokens <= 0) return
    const pct = (contextTokens / ctxWindow(contextModel)) * 100
    if (pct >= 80) void compact()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextTokens, contextModel])

  return { compacting, compactPct, compact }
}
