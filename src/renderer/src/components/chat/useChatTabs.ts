// Conversation-tabs state machine, extracted from App.tsx (behavior-preserving).
// Each tab is an independent conversation with its own isolated workspace
// (tab.key); switching tabs never interrupts a running one. Owns the open/close/
// focus/resume logic + per-tab model/persona overrides + the session→workspace
// persistence so a resumed conversation reuses its original dir.
import { useState } from 'react'
import type { SessionInfo } from '../../types'
import { loadJson, saveJson } from '../../lib/storage'

/** One open conversation tab. `key` is also the isolated workspace id for the
 * conversation, so concurrent tabs can't edit the same files. */
export interface ChatTab {
  key: string
  sessionId: string | null
  /** Bumped to force the Composer to reset/restore when the tab's session changes. */
  sessionKey: number
  /** Per-conversation model override (set via /model); falls back to the global. */
  model?: string
  /** Per-conversation persona override (set via /persona); falls back to global. */
  persona?: string
}

export const MAX_TABS = 5
const WS_MAP_KEY = 'forge-session-ws'

/** Stable workspace id for a resumed session (so it reuses the dir where it did
 * its file work), or null if this session predates the mapping. */
function wsKeyForSession(sid: string): string | null {
  return loadJson<Record<string, string>>(WS_MAP_KEY, {})[sid] ?? null
}
/** Remember which workspace a session belongs to, so a later resume reuses it. */
function rememberSessionWs(sid: string, key: string): void {
  const m = loadJson<Record<string, string>>(WS_MAP_KEY, {})
  if (m[sid] === key) return
  m[sid] = key
  saveJson(WS_MAP_KEY, m)
}

export interface ChatTabs {
  tabs: ChatTab[]
  activeKey: string
  activeTab: ChatTab | undefined
  /** Active tab's session id (drives the sidebar highlight + usage). */
  sessionId: string | null
  setActiveKey: (k: string) => void
  newSession: () => void
  resumeSession: (id: string) => void
  resetTab: (key: string) => void
  setTabSession: (key: string, sid: string) => void
  setTabModel: (key: string, value: string) => void
  setTabPersona: (key: string, persona: string | null) => void
  closeTab: (key: string) => void
  tabTitle: (t: ChatTab) => string
  /** Reset any open tab showing a (deleted) conversation to a fresh one. */
  clearTabsForSession: (id: string) => void
}

export function useChatTabs(opts: {
  sessions: SessionInfo[]
  /** Called when a per-conversation /model override is set (exits cost-saver). */
  onExitCostSaver: () => void
}): ChatTabs {
  const { sessions, onExitCostSaver } = opts
  const [tabs, setTabs] = useState<ChatTab[]>(() => [{ key: 't0', sessionId: null, sessionKey: 0 }])
  const [activeKey, setActiveKey] = useState('t0')
  const activeTab = tabs.find((t) => t.key === activeKey) ?? tabs[0]
  const sessionId = activeTab?.sessionId ?? null

  /** Open a fresh conversation tab (or focus an existing empty one / the cap). */
  function newSession(): void {
    const empty = tabs.find((t) => t.sessionId === null)
    if (empty) {
      setActiveKey(empty.key)
      return
    }
    if (tabs.length >= MAX_TABS) return // at cap — close a tab first
    const t: ChatTab = { key: crypto.randomUUID(), sessionId: null, sessionKey: 0 }
    setTabs((prev) => [...prev, t])
    setActiveKey(t.key)
  }
  /** Open a saved conversation: focus its tab if open, else load it (reusing the
   * active empty tab when possible) so it resumes in its original workspace. */
  function resumeSession(id: string): void {
    const open = tabs.find((t) => t.sessionId === id)
    if (open) {
      setActiveKey(open.key)
      return
    }
    const wsKey = wsKeyForSession(id) ?? crypto.randomUUID()
    rememberSessionWs(id, wsKey)
    const active = tabs.find((t) => t.key === activeKey)
    if ((active && active.sessionId === null) || tabs.length >= MAX_TABS) {
      const target = active && active.sessionId === null ? active.key : activeKey
      setTabs((prev) =>
        prev.map((t) =>
          t.key === target ? { key: wsKey, sessionId: id, sessionKey: t.sessionKey + 1 } : t
        )
      )
      setActiveKey(wsKey)
      return
    }
    setTabs((prev) => [...prev, { key: wsKey, sessionId: id, sessionKey: 0 }])
    setActiveKey(wsKey)
  }
  /** Reset a tab to a fresh conversation (the /clear or /new command within it). */
  function resetTab(key: string): void {
    setTabs((prev) =>
      prev.map((t) => (t.key === key ? { ...t, sessionId: null, sessionKey: t.sessionKey + 1 } : t))
    )
  }
  /** A run in `key` established its session id — record it (+ its workspace). */
  function setTabSession(key: string, sid: string): void {
    rememberSessionWs(sid, key)
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, sessionId: sid } : t)))
  }
  /** Set/clear a tab's per-conversation model override (via /model). 'global'
   * clears it back to the sidebar default. */
  function setTabModel(key: string, value: string): void {
    onExitCostSaver()
    const model = value === 'global' || value === '' ? undefined : value
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, model } : t)))
  }
  /** Set/clear a tab's per-conversation persona override (via /persona). */
  function setTabPersona(key: string, persona: string | null): void {
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, persona: persona || undefined } : t)))
  }
  /** Close a tab (always keep at least one); focus a neighbor if it was active. */
  function closeTab(key: string): void {
    if (tabs.length <= 1) return
    const idx = tabs.findIndex((t) => t.key === key)
    const next = tabs.filter((t) => t.key !== key)
    setTabs(next)
    if (key === activeKey) setActiveKey(next[Math.max(0, idx - 1)].key)
  }
  /** Title for a tab: the saved session's title, else "New chat". */
  function tabTitle(t: ChatTab): string {
    if (!t.sessionId) return 'New chat'
    return sessions.find((s) => s.sessionId === t.sessionId)?.title ?? 'Chat'
  }
  function clearTabsForSession(id: string): void {
    setTabs((prev) =>
      prev.map((t) => (t.sessionId === id ? { ...t, sessionId: null, sessionKey: t.sessionKey + 1 } : t))
    )
  }

  return {
    tabs,
    activeKey,
    activeTab,
    sessionId,
    setActiveKey,
    newSession,
    resumeSession,
    resetTab,
    setTabSession,
    setTabModel,
    setTabPersona,
    closeTab,
    tabTitle,
    clearTabsForSession
  }
}
