// Past-conversation listing + transcript reconstruction (docs/MAINTAINABILITY.md
// Phase 4). Extracted verbatim from the former src/main/agent.ts.

import { sep } from 'path'
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

/**
 * The cwd a saved session was originally run in. The SDK resolves a `resume`
 * by the project key derived from cwd, so a resume MUST run in this exact dir or
 * it fails — even though getSessionMessages (the transcript) finds the session
 * regardless of cwd. Searches all project dirs (dir omitted). undefined if unknown.
 */
export async function getSessionCwd(sessionId: string): Promise<string | undefined> {
  const sdk: any = await import('@anthropic-ai/claude-agent-sdk')
  try {
    const info = await sdk.getSessionInfo(sessionId)
    const cwd = info?.cwd
    return typeof cwd === 'string' && cwd ? cwd : undefined
  } catch {
    return undefined
  }
}

/** One conversation that matched a cross-conversation search. */
export interface SessionSearchHit {
  sessionId: string
  title: string
  snippet: string
  matches: number
}

/** A short context window around the first match. */
function snippetAround(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 45)
  const end = Math.min(text.length, idx + len + 70)
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return (start > 0 ? '…' : '') + body + (end < text.length ? '…' : '')
}

/**
 * Search every (Forge-workspace) conversation's transcript for `query`, returning
 * the matching sessions with a match count + a snippet, most matches first. Reads
 * the stored transcripts locally (no model, no tokens); capped to the recent
 * session list so it stays responsive.
 */
export async function searchSessions(query: string): Promise<SessionSearchHit[]> {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const sdk: any = await import('@anthropic-ai/claude-agent-sdk')
  const sessions = await getSessions()
  const hits: SessionSearchHit[] = []
  for (const s of sessions) {
    try {
      const msgs: any[] = (await sdk.getSessionMessages(s.sessionId)) ?? []
      let matches = 0
      let snippet = ''
      for (const m of msgs) {
        const content = m.message?.content
        const text =
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.map((b: any) => (b?.type === 'text' ? (b.text ?? '') : '')).join(' ')
              : ''
        if (!text) continue
        const lc = text.toLowerCase()
        let idx = lc.indexOf(q)
        while (idx >= 0) {
          matches++
          if (!snippet) snippet = snippetAround(text, idx, q.length)
          idx = lc.indexOf(q, idx + q.length)
        }
      }
      if (matches > 0) hits.push({ sessionId: s.sessionId, title: s.title, snippet, matches })
    } catch {
      /* skip unreadable session */
    }
  }
  return hits.sort((a, b) => b.matches - a.matches)
}

/** Rename a saved conversation (persists as the SDK customTitle). Best-effort. */
export async function renameSession(sessionId: string, title: string): Promise<void> {
  const sdk: any = await import('@anthropic-ai/claude-agent-sdk')
  // dir omitted → the SDK searches every project dir, so this finds the session
  // regardless of which isolated workspace (ws/<id>) it lives in.
  try {
    await sdk.renameSession(sessionId, title)
  } catch {
    /* best-effort */
  }
}

/** Permanently delete a saved conversation's stored transcript. Best-effort. */
export async function deleteSession(sessionId: string): Promise<void> {
  const sdk: any = await import('@anthropic-ai/claude-agent-sdk')
  try {
    await sdk.deleteSession(sessionId)
  } catch {
    /* best-effort */
  }
}

/** Recent conversations for this project (cwd), newest first. */
export async function getSessions(): Promise<SessionInfo[]> {
  const sdk: any = await import('@anthropic-ai/claude-agent-sdk')
  try {
    const all: any[] = (await sdk.listSessions()) ?? []
    // Runs are anchored to the Forge workspace (see ensureWorkspace), so match
    // sessions to it — not process.cwd(), which differs in dev vs packaged.
    // Concurrent conversations run in ISOLATED subdirs (<root>/ws/<id>), so accept
    // the root and anything under it, not just an exact root match.
    const cwd = workspaceDir()
    return all
      .filter((s) => !s.cwd || s.cwd === cwd || s.cwd.startsWith(cwd + sep))
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
