// Conversation compaction (docs/MAINTAINABILITY.md Phase 4). Extracted verbatim
// from the former src/main/agent.ts.

import { type WebContents } from 'electron'
import { buildEnv, ensureWorkspace, ensureResumeCwd } from './env'
import { getSessionCwd } from './sessions'
import { active } from './state'
import type { ActiveQuery, CompactProgress } from './types'

/**
 * Compact a conversation to shrink its context. Keeps the same session id.
 *
 * When a `sender` is provided, progress is streamed on the `agent:compact-progress`
 * channel so the renderer can show a live progress bar. The SDK `/compact` run is
 * opaque (no real percentage), so progress is modeled by a TIME-BASED ticker that
 * climbs 1% at a time toward 90% while the summarizer runs (so the bar visibly
 * moves instead of stalling between the few streamed messages), then snaps to 100%
 * on completion.
 */
export async function compactSession(
  sessionId: string,
  sender?: WebContents,
  workspaceId?: string
): Promise<{ ok: boolean; sessionId: string; error?: string }> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const env = await buildEnv()
  // Resume must run in the SAME cwd as the run that created the session, or the
  // SDK can't locate it — it would start a fresh empty session and orphan the
  // conversation. Prefer the session's recorded cwd (correct across restarts and
  // for pre-isolation sessions, where the passed workspaceId can be wrong); fall
  // back to the conversation's isolated ws/<id>.
  const recordedCwd = await getSessionCwd(sessionId)
  const cwd = recordedCwd ? await ensureResumeCwd(recordedCwd) : await ensureWorkspace(workspaceId)
  let sid = sessionId
  let ok = false
  let error: string | undefined

  const emit = (p: CompactProgress): void => {
    if (sender && !sender.isDestroyed()) sender.send('agent:compact-progress', p)
  }

  emit({ sessionId: sid, phase: 'start', pct: 5 })

  // Time-based ticker: climb 1% every 250ms toward a 90% ceiling so the bar is
  // visibly alive for the whole opaque run. Cleared the moment the run resolves.
  let pct = 5
  const ticker = setInterval(() => {
    if (pct < 90) {
      pct += 1
      emit({ sessionId: sid, phase: 'working', pct })
    }
  }, 250)

  // Register under a synthetic run id so interruptAll() (window-close / quit) can
  // stop an in-flight compact. Without it the SDK subprocess keeps running — and
  // billing — in the background after all windows close (notably on macOS, where
  // closing the last window doesn't quit the app).
  const compactRunId = `compact:${sessionId}`
  try {
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
    active.set(compactRunId, q as ActiveQuery)
    for await (const msg of q as AsyncIterable<any>) {
      if (msg.session_id) sid = msg.session_id
      if (msg.type === 'result') ok = msg.subtype === 'success'
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  } finally {
    clearInterval(ticker)
    active.delete(compactRunId)
  }
  emit({ sessionId: sid, phase: error || !ok ? 'error' : 'done', pct: 100, error })
  return { ok, sessionId: sid, error }
}
