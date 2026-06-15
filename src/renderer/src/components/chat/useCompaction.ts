// Context compaction for the composer: the manual /compact + the live progress
// bar + opt-in auto-compact at 80% context. Extracted from Composer.tsx
// (behavior-preserving).
import { useEffect, useState } from 'react'
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
}): Compaction {
  const {
    sessionIdRef,
    onSessionRef,
    pushNotice,
    setContextTokens,
    autoCompact,
    running,
    contextTokens,
    contextModel
  } = opts
  const [compacting, setCompacting] = useState(false)
  const [compactPct, setCompactPct] = useState(0)

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
      const r = await window.forge.agent.compact(sid)
      if (r.ok) {
        onSessionRef.current(r.sessionId)
        pushNotice('⟲ /compact', '✓ Context compacted — older messages summarized.')
        setContextTokens(0)
      } else {
        pushNotice('⟲ /compact', `Compact failed${r.error ? ': ' + r.error : ''}`)
      }
    } finally {
      setCompacting(false)
      // Brief settle so the bar visibly reaches 100% before it disappears.
      setTimeout(() => setCompactPct(0), 600)
    }
  }

  // Auto-compact when context crosses 80% (opt-in via the LIMITS toggle).
  useEffect(() => {
    if (!autoCompact || compacting || running || !sessionIdRef.current || contextTokens <= 0) return
    const pct = (contextTokens / ctxWindow(contextModel)) * 100
    if (pct >= 80) compact()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextTokens])

  return { compacting, compactPct, compact }
}
