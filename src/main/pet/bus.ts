// Leaf event bus that taps the agent event stream for the desktop pet. Kept
// dependency-free (type-only import) so `runStreaming.ts` can emit into it
// without creating an import cycle through the pet/state modules.
import type { AgentEvent } from '../agent/types'

type Listener = (ev: AgentEvent) => void

const listeners = new Set<Listener>()

/** Called from runStreaming for every emitted AgentEvent. */
export function emitAgentEvent(ev: AgentEvent): void {
  if (listeners.size === 0) return
  for (const l of listeners) {
    try {
      l(ev)
    } catch {
      /* a misbehaving listener must not break the run */
    }
  }
}

/** Subscribe; returns an unsubscribe fn. */
export function onAgentEvent(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
