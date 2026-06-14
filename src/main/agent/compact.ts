// Conversation compaction (docs/MAINTAINABILITY.md Phase 4). Extracted verbatim
// from the former src/main/agent.ts.

import { buildEnv, ensureWorkspace } from './env'

/** Compact a conversation to shrink its context. Keeps the same session id. */
export async function compactSession(
  sessionId: string
): Promise<{ ok: boolean; sessionId: string; error?: string }> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const env = await buildEnv()
  const cwd = await ensureWorkspace()
  let sid = sessionId
  let ok = false
  let error: string | undefined
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
    for await (const msg of q as AsyncIterable<any>) {
      if (msg.session_id) sid = msg.session_id
      if (msg.type === 'result') ok = msg.subtype === 'success'
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  return { ok, sessionId: sid, error }
}
