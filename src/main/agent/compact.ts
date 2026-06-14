// Conversation compaction (docs/MAINTAINABILITY.md Phase 4). Extracted verbatim
// from the former src/main/agent.ts.

import { type WebContents } from 'electron'
import { buildEnv, ensureWorkspace } from './env'
import type { CompactProgress } from './types'

/**
 * Compact a conversation to shrink its context. Keeps the same session id.
 *
 * When a `sender` is provided, progress is streamed on the `agent:compact-progress`
 * channel so the renderer can show a live progress bar. The SDK `/compact` run is
 * opaque (no real percentage), so progress is modeled as a monotonic curve that
 * eases toward 90% while the summarizer streams, then snaps to 100% on completion.
 */
export async function compactSession(
  sessionId: string,
  sender?: WebContents
): Promise<{ ok: boolean; sessionId: string; error?: string }> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const env = await buildEnv()
  const cwd = await ensureWorkspace()
  let sid = sessionId
  let ok = false
  let error: string | undefined

  const emit = (p: CompactProgress): void => {
    if (sender && !sender.isDestroyed()) sender.send('agent:compact-progress', p)
  }

  emit({ sessionId: sid, phase: 'start', pct: 5 })
  try {
    // cwd must match the run that created the session, or resume can't locate it.
    const q: any = query({
      prompt: '/compact',
      options: {
        permissionMode: 'bypassPermissions',
        maxTurns: 1,
        resume: sessionId,
        env,
        cwd
      } as any
    })
    let pct = 5
    for await (const msg of q as AsyncIterable<any>) {
      if (msg.session_id) sid = msg.session_id
      if (msg.type === 'result') {
        ok = msg.subtype === 'success'
      } else {
        // Ease toward 90% — each streamed message closes ~30% of the remaining gap.
        pct = Math.min(90, pct + (90 - pct) * 0.3)
        emit({ sessionId: sid, phase: 'working', pct: Math.round(pct) })
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  emit({ sessionId: sid, phase: error || !ok ? 'error' : 'done', pct: 100, error })
  return { ok, sessionId: sid, error }
}
