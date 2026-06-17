// Conversation-tabs state machine, extracted from App.tsx (behavior-preserving).
// Each tab is an independent conversation with its own isolated workspace
// (tab.key); switching tabs never interrupts a running one. Owns the open/close/
// focus/resume logic + per-tab model/persona overrides + the session→workspace
// persistence so a resumed conversation reuses its original dir.
import { useState } from 'react'
import type { EffortLabel, SessionInfo } from '../../types'
import { loadJson, saveJson } from '../../lib/storage'

/** One open conversation tab. `key` is also the isolated workspace id for the
 * conversation, so concurrent tabs can't edit the same files. */
export interface ChatTab {
  key: string
  sessionId: string | null
  /** Bumped to force the Composer to reset/restore when the tab's session changes. */
  sessionKey: number
  /** Per-conversation model override (set via /model or the chat controls); falls
   * back to the global sidebar default. */
  model?: string
  /** Per-conversation effort override (set via /effort or the chat controls);
   * falls back to the global sidebar default. */
  effort?: EffortLabel
  /** Per-conversation persona override (set via /persona); falls back to global. */
  persona?: string
}

export const MAX_TABS = 5
const WS_MAP_KEY = 'forge-session-ws'
const OPTS_MAP_KEY = 'forge-session-opts'

/** Per-conversation overrides persisted by session id, so the per-chat model /
 * effort / persona a user picked survive a restart (and resuming the chat). */
interface SessionOpts {
  model?: string
  effort?: EffortLabel
  persona?: string
}

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

/** Load a session's saved per-chat overrides (model / effort / persona). */
function loadSessionOpts(sid: string): SessionOpts {
  return loadJson<Record<string, SessionOpts>>(OPTS_MAP_KEY, {})[sid] ?? {}
}
/** Merge-save a session's per-chat overrides; undefined fields are dropped so a
 * cleared override reverts that field to the global default on the next resume. */
function saveSessionOpts(sid: string, patch: SessionOpts): void {
  const m = loadJson<Record<string, SessionOpts>>(OPTS_MAP_KEY, {})
  const next: SessionOpts = { ...(m[sid] ?? {}), ...patch }
  for (const k of Object.keys(next) as (keyof SessionOpts)[]) {
    if (next[k] === undefined) delete next[k]
  }
  if (Object.keys(next).length === 0) delete m[sid]
  else m[sid] = next
  saveJson(OPTS_MAP_KEY, m)
}
/** Drop a deleted session from both persisted maps (no unbounded growth). */
function forgetSessionMaps(sid: string): void {
  const ws = loadJson<Record<string, string>>(WS_MAP_KEY, {})
  if (sid in ws) {
    delete ws[sid]
    saveJson(WS_MAP_KEY, ws)
  }
  const opts = loadJson<Record<string, SessionOpts>>(OPTS_MAP_KEY, {})
  if (sid in opts) {
    delete opts[sid]
    saveJson(OPTS_MAP_KEY, opts)
  }
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
  setTabEffort: (key: string, value: EffortLabel | 'GLOBAL') => void
  setTabPersona: (key: string, persona: string | null) => void
  closeTab: (key: string) => void
  tabTitle: (t: ChatTab) => string
  /** Reset any open tab showing a (deleted) conversation to a fresh one. */
  clearTabsForSession: (id: string) => void
  /** Forget a deleted session's persisted workspace + per-chat overrides. */
  forgetSession: (id: string) => void
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
    // Restore the per-chat model/effort/persona this conversation was last using.
    const saved = loadSessionOpts(id)
    const seed = { model: saved.model, effort: saved.effort, persona: saved.persona }
    const active = tabs.find((t) => t.key === activeKey)
    if ((active && active.sessionId === null) || tabs.length >= MAX_TABS) {
      const target = active && active.sessionId === null ? active.key : activeKey
      setTabs((prev) =>
        prev.map((t) =>
          t.key === target
            ? { key: wsKey, sessionId: id, sessionKey: t.sessionKey + 1, ...seed }
            : t
        )
      )
      setActiveKey(wsKey)
      return
    }
    setTabs((prev) => [...prev, { key: wsKey, sessionId: id, sessionKey: 0, ...seed }])
    setActiveKey(wsKey)
  }
  /** Reset a tab to a fresh conversation (the /clear or /new command within it). */
  function resetTab(key: string): void {
    setTabs((prev) =>
      prev.map((t) => (t.key === key ? { ...t, sessionId: null, sessionKey: t.sessionKey + 1 } : t))
    )
  }
  /** A run in `key` established its session id — record it (+ its workspace) and
   * persist whatever per-chat overrides the tab currently carries so they survive
   * a restart / resume. */
  function setTabSession(key: string, sid: string): void {
    rememberSessionWs(sid, key)
    const t = tabs.find((x) => x.key === key)
    if (t) saveSessionOpts(sid, { model: t.model, effort: t.effort, persona: t.persona })
    setTabs((prev) => prev.map((x) => (x.key === key ? { ...x, sessionId: sid } : x)))
  }
  /** Set/clear a tab's per-conversation model override (via /model or the chat
   * controls). 'global' clears it back to the sidebar default. */
  function setTabModel(key: string, value: string): void {
    onExitCostSaver()
    const model = value === 'global' || value === '' ? undefined : value
    const t = tabs.find((x) => x.key === key)
    if (t?.sessionId) saveSessionOpts(t.sessionId, { model })
    setTabs((prev) => prev.map((x) => (x.key === key ? { ...x, model } : x)))
  }
  /** Set/clear a tab's per-conversation effort override (via /effort or the chat
   * controls). 'GLOBAL' clears it back to the sidebar default. */
  function setTabEffort(key: string, value: EffortLabel | 'GLOBAL'): void {
    onExitCostSaver()
    const effort = value === 'GLOBAL' ? undefined : value
    const t = tabs.find((x) => x.key === key)
    if (t?.sessionId) saveSessionOpts(t.sessionId, { effort })
    setTabs((prev) => prev.map((x) => (x.key === key ? { ...x, effort } : x)))
  }
  /** Set/clear a tab's per-conversation persona override (via /persona). */
  function setTabPersona(key: string, persona: string | null): void {
    const t = tabs.find((x) => x.key === key)
    if (t?.sessionId) saveSessionOpts(t.sessionId, { persona: persona || undefined })
    setTabs((prev) =>
      prev.map((x) => (x.key === key ? { ...x, persona: persona || undefined } : x))
    )
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
  /** Forget a deleted session's persisted workspace mapping + per-chat overrides
   * so the localStorage maps don't grow without bound. */
  function forgetSession(id: string): void {
    forgetSessionMaps(id)
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
    setTabEffort,
    setTabPersona,
    closeTab,
    tabTitle,
    clearTabsForSession,
    forgetSession
  }
}
