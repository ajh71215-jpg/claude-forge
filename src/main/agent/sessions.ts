// Past-conversation listing + transcript reconstruction (docs/MAINTAINABILITY.md
// Phase 4). Extracted verbatim from the former src/main/agent.ts.

import { workspaceDir } from './env'
import { toolContentToString } from './helpers'
import type { SessionInfo, TranscriptItem } from './types'

/** Reconstruct a past conversation's transcript for display. */
export async function getTranscript(sessionId: string): Promise<TranscriptItem[]> {
  const sdk: any = await import('@anthropic-ai/claude-agent-sdk')
  try {
    const msgs: any[] = (await sdk.getSessionMessages(sessionId)) ?? []
    const items: TranscriptItem[] = []
    const toolIndex = new Map<string, Extract<TranscriptItem, { kind: 'tool' }>>()
    for (const m of msgs) {
      const role = m.message?.role
      const content = m.message?.content
      if (role === 'user') {
        if (typeof content === 'string') {
          const t = content.trim()
          // Skip harness/system-tagged messages (<command-name>, <system-reminder>…).
          if (t && !t.startsWith('<')) items.push({ kind: 'user', text: t })
        } else if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type === 'tool_result') {
              const tool = toolIndex.get(b.tool_use_id)
              if (tool) {
                tool.status = b.is_error ? 'error' : 'ok'
                tool.result = toolContentToString(b.content)
              }
            } else if (b.type === 'text') {
              const t = (b.text ?? '').trim()
              if (t && !t.startsWith('<')) items.push({ kind: 'user', text: t })
            }
          }
        }
      } else if (role === 'assistant' && Array.isArray(content)) {
        for (const b of content) {
          if (b.type === 'text' && (b.text ?? '').trim()) {
            items.push({ kind: 'text', text: b.text })
          } else if (b.type === 'thinking' && (b.thinking ?? '').trim()) {
            items.push({ kind: 'thinking', text: b.thinking })
          } else if (b.type === 'tool_use') {
            const item: Extract<TranscriptItem, { kind: 'tool' }> = {
              kind: 'tool',
              toolId: b.id,
              name: b.name,
              input: b.input,
              status: 'ok'
            }
            items.push(item)
            toolIndex.set(b.id, item)
          }
        }
      }
    }
    return items.slice(-300)
  } catch {
    return []
  }
}

/** Recent conversations for this project (cwd), newest first. */
export async function getSessions(): Promise<SessionInfo[]> {
  const sdk: any = await import('@anthropic-ai/claude-agent-sdk')
  try {
    const all: any[] = (await sdk.listSessions()) ?? []
    // Runs are anchored to the Forge workspace (see ensureWorkspace), so match
    // sessions to it — not process.cwd(), which differs in dev vs packaged.
    const cwd = workspaceDir()
    return all
      .filter((s) => !s.cwd || s.cwd === cwd)
      // Hide internal/utility sessions (usage probes, empty capability queries).
      .filter((s) => {
        const fp = (s.firstPrompt ?? '').trim()
        return fp && !fp.startsWith('/usage') && !fp.startsWith('/context') && !fp.startsWith('/compact')
      })
      .map((s) => ({
        sessionId: s.sessionId,
        title: s.customTitle || s.summary || s.firstPrompt || s.sessionId,
        firstPrompt: s.firstPrompt,
        lastModified: s.lastModified
      }))
      .sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0))
      .slice(0, 25)
  } catch {
    return []
  }
}
