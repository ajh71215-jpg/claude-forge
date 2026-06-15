import { useEffect, useMemo, useState, type JSX } from 'react'
import AuthGate from './components/AuthGate'
import Icon from './components/Icon'
import Sidebar from './components/Sidebar'
import TitleBar from './components/TitleBar'
import ExtendView from './components/extend/ExtendView'
import Composer from './components/chat/Composer'
import SquadView from './components/squad/SquadView'
import CostView from './components/cost/CostView'
import GuideView from './components/guide/GuideView'
import PersonaModal from './components/persona/PersonaModal'
import CommandPalette, { type PaletteAction } from './components/palette/CommandPalette'
import ShortcutsHelp from './components/ShortcutsHelp'
import { ConfirmProvider } from './components/ConfirmDialog'
import type {
  AuthMode,
  AuthStatus,
  Permission,
  ModelInfo,
  SlashCommand,
  Capabilities,
  SessionInfo,
  UsageInfo,
  Persona,
  EffortLabel
} from './types'
import { EFFORTS, PERMS, effortOption } from './lib/constants'
import { resolveMaxTurns } from './lib/format'

/** Read a JSON value from localStorage, falling back to a default on any error. */
function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/** Persist a JSON value to localStorage (best-effort). */
function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore quota / serialization errors */
  }
}

/** One open conversation tab. `key` is also the isolated workspace id for the
 * conversation, so concurrent tabs can't edit the same files. */
interface ChatTab {
  key: string
  sessionId: string | null
  /** Bumped to force the Composer to reset/restore when the tab's session changes. */
  sessionKey: number
}

const WS_MAP_KEY = 'forge-session-ws'
const MAX_TABS = 5

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

/**
 * Step 1+: probe auth status. Not configured -> the auth-method gate. Configured
 * -> the (still mostly empty) main shell that later steps fill with the chat,
 * thinking blocks, tool cards and the left-hand selectors.
 */
export default function App(): JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null)

  async function refresh(): Promise<void> {
    setStatus(await window.forge.auth.status())
  }
  useEffect(() => {
    refresh()
  }, [])

  return (
    <ConfirmProvider>
      <div className="app">
        <TitleBar />
        <div className="app-body">
          {status === null ? (
            <div className="boot">heating the forge…</div>
          ) : status.mode === null ? (
            <AuthGate hasExistingLogin={status.hasExistingLogin} onAuthed={refresh} />
          ) : (
            <MainShell mode={status.mode} onClear={refresh} />
          )}
        </div>
      </div>
    </ConfirmProvider>
  )
}

/* TitleBar → ./components/TitleBar · PersonaModal → ./components/persona/PersonaModal */

function MainShell({ mode, onClear }: { mode: AuthMode; onClear: () => void }): JSX.Element {
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [model, setModel] = useState<string>('default')
  const [permission, setPermission] = useState<Permission>('ask')
  const [effort, setEffort] = useState<EffortLabel>('AUTO')
  const [usage, setUsage] = useState({
    costUsd: 0,
    input: 0,
    output: 0,
    runs: 0,
    cacheRead: 0,
    cacheWrite: 0,
    promptTotal: 0
  })
  const [subUsage, setSubUsage] = useState<UsageInfo | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  // Open conversation tabs. Each runs concurrently in its own isolated workspace
  // (tab.key) and keeps streaming when you switch tabs (no interrupt). The active
  // conversation's sessionId drives the sidebar highlight + usage.
  const [tabs, setTabs] = useState<ChatTab[]>(() => [{ key: 't0', sessionId: null, sessionKey: 0 }])
  const [activeKey, setActiveKey] = useState('t0')
  const activeTab = tabs.find((t) => t.key === activeKey) ?? tabs[0]
  const sessionId = activeTab?.sessionId ?? null
  // Per-model max turns. Each model keeps its own override; unset models fall
  // back to defaultMaxTurns(model). Keyed by model id ('default' = the active
  // account default model). Persisted (with the budget/auto-compact LIMITS) so a
  // safety cap the user set survives restarts instead of silently resetting to off.
  const [maxTurnsByModel, setMaxTurnsByModel] = useState<Record<string, number>>(() =>
    loadJson('forge-max-turns', {})
  )
  const maxTurns = resolveMaxTurns(maxTurnsByModel, model)
  const setMaxTurns = (n: number): void =>
    setMaxTurnsByModel((m) => ({ ...m, [model]: Math.max(1, n) }))
  const [maxBudget, setMaxBudget] = useState<number>(() => loadJson('forge-max-budget', 0)) // 0 = off
  const [autoCompact, setAutoCompact] = useState<boolean>(() => loadJson('forge-auto-compact', false))
  const [costSaver, setCostSaver] = useState(false)
  // Persist the LIMITS settings whenever they change.
  useEffect(() => saveJson('forge-max-turns', maxTurnsByModel), [maxTurnsByModel])
  useEffect(() => saveJson('forge-max-budget', maxBudget), [maxBudget])
  useEffect(() => saveJson('forge-auto-compact', autoCompact), [autoCompact])
  const [view, setView] = useState<'chat' | 'squad' | 'cost' | 'extend' | 'guide'>('chat')
  const [persona, setPersonaState] = useState<Persona | null>(null)
  const [showPersona, setShowPersona] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  function refreshSessions(): void {
    window.forge.agent.sessions().then(setSessions).catch(() => {})
  }
  function refreshUsage(): void {
    window.forge.agent.usage().then(setSubUsage).catch(() => {})
  }
  // Re-probe capabilities (slash commands, MCP, models) — e.g. after the EXTEND
  // console authors a new command, so it appears in the composer slash menu.
  function refreshCaps(): void {
    window.forge.agent.capabilities().then(setCaps).catch(() => {})
  }

  useEffect(() => {
    window.forge.agent
      .capabilities()
      .then(setCaps)
      .catch(() => setCaps({ models: [], commands: [], mcpServers: [] }))
    refreshSessions()
    refreshUsage()
    window.forge.persona
      .get()
      .then(setPersonaState)
      .catch(() => setPersonaState({ enabled: false, mode: 'append', text: '' }))
    // Refresh plan usage on a slow timer instead of every turn (avoids a
    // /usage subprocess spawn per message). Skip ticks while the window is hidden
    // — no point spawning a /usage subprocess for a backgrounded window — and
    // refresh once when it becomes visible again so the panel isn't stale.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshUsage()
    }, 90_000)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refreshUsage()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const models: ModelInfo[] = caps?.models ?? []
  const commands: SlashCommand[] = caps?.commands ?? []
  const mcpServers = caps?.mcpServers ?? []

  function onResult(r: {
    costUsd?: number
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    contextTokens?: number
  }): void {
    setUsage((u) => ({
      costUsd: u.costUsd + (r.costUsd ?? 0),
      input: u.input + (r.inputTokens ?? 0),
      output: u.output + (r.outputTokens ?? 0),
      runs: u.runs + 1,
      cacheRead: u.cacheRead + (r.cacheReadTokens ?? 0),
      cacheWrite: u.cacheWrite + (r.cacheWriteTokens ?? 0),
      promptTotal: u.promptTotal + (r.contextTokens ?? 0)
    }))
    refreshSessions()
  }

  // ── Conversation tabs ──
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
  // Manually choosing a model/effort exits cost-saver mode.
  function chooseModel(v: string): void {
    setModel(v)
    setCostSaver(false)
  }
  function chooseEffort(l: EffortLabel): void {
    setEffort(l)
    setCostSaver(false)
  }
  // Cost-saver no longer forces a flat model/effort here — Composer routes each
  // prompt to a tier by difficulty (lever 4). App only passes the flag + the
  // manual selections it falls back to when cost-saver is off.

  // Effort levels the selected model accepts (reported by the SDK). AUTO is
  // always valid (it sends no effort param). Models that report no levels — e.g.
  // Haiku, which has no effort control — or custom ids not in the list disable
  // the non-AUTO cells so an unsupported effort is never sent (it would error).
  const modelEfforts = models.find((m) => m.value === model)?.supportedEffortLevels
  function effortSupported(label: EffortLabel): boolean {
    if (label === 'AUTO') return true
    if (!modelEfforts) return true // no info (custom id) → don't constrain
    return modelEfforts.includes(label.toLowerCase())
  }
  // Switching to a model that can't do the current effort (e.g. Haiku) snaps
  // the selection back to AUTO so the run doesn't carry an unsupported level.
  useEffect(() => {
    if (!effortSupported(effort)) setEffort('AUTO')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, modelEfforts])

  async function clear(): Promise<void> {
    await window.forge.auth.clear()
    onClear()
  }

  // Cmd/Ctrl+K toggles the command palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Actions surfaced in the command palette — the shell's existing handlers, made
  // keyboard-reachable. Rebuilt when the dynamic lists (models/sessions) change.
  const paletteActions = useMemo<PaletteAction[]>(() => {
    const go = (label: string, v: typeof view): PaletteAction => ({
      id: 'view-' + v,
      section: 'Go to',
      label,
      run: () => setView(v)
    })
    const acts: PaletteAction[] = [
      go('Chat', 'chat'),
      go('Agents', 'squad'),
      go('Cost & Cache', 'cost'),
      go('Extend', 'extend'),
      go('Guide', 'guide'),
      { id: 'new', section: 'Session', label: 'New conversation', hint: '/new', run: newSession },
      {
        id: 'persona',
        section: 'Agent',
        label: 'Customize agent…',
        keywords: 'persona system prompt',
        run: () => setShowPersona(true)
      },
      {
        id: 'shortcuts',
        section: 'Help',
        label: 'Keyboard shortcuts',
        keywords: 'keys hotkeys help',
        run: () => setShortcutsOpen(true)
      },
      {
        id: 'saver',
        section: 'Settings',
        label: costSaver ? 'Turn off cost-saver routing' : 'Turn on cost-saver routing',
        keywords: 'cheap difficulty route',
        run: () => setCostSaver((v) => !v)
      }
    ]
    for (const p of PERMS)
      acts.push({
        id: 'perm-' + p.id,
        section: 'Permission',
        label: `Permission: ${p.title}`,
        keywords: p.desc,
        run: () => setPermission(p.id)
      })
    for (const e of EFFORTS)
      if (effortSupported(e))
        acts.push({ id: 'effort-' + e, section: 'Effort', label: `Effort: ${e}`, run: () => chooseEffort(e) })
    for (const m of models)
      acts.push({
        id: 'model-' + m.value,
        section: 'Model',
        label: `Model: ${m.displayName}`,
        keywords: m.value,
        run: () => chooseModel(m.value)
      })
    for (const s of sessions.slice(0, 8))
      acts.push({
        id: 'sess-' + s.sessionId,
        section: 'Resume',
        label: s.title,
        run: () => resumeSession(s.sessionId)
      })
    acts.push({ id: 'disconnect', section: 'Account', label: 'Disconnect', run: clear })
    return acts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, sessions, costSaver, modelEfforts])

  return (
    <div className="shell">
      <Sidebar
        mode={mode}
        caps={caps}
        models={models}
        mcpServers={mcpServers}
        model={model}
        permission={permission}
        effort={effort}
        costSaver={costSaver}
        modelEfforts={modelEfforts}
        effortSupported={effortSupported}
        maxTurns={maxTurns}
        maxTurnsByModel={maxTurnsByModel}
        maxBudget={maxBudget}
        autoCompact={autoCompact}
        subUsage={subUsage}
        usage={usage}
        sessions={sessions}
        sessionId={sessionId}
        persona={persona}
        onChooseModel={chooseModel}
        onChooseEffort={chooseEffort}
        onSetPermission={setPermission}
        onSetCostSaver={setCostSaver}
        onSetMaxTurns={setMaxTurns}
        onResetMaxTurns={() =>
          setMaxTurnsByModel((m) => {
            const next = { ...m }
            delete next[model]
            return next
          })
        }
        onSetMaxBudget={setMaxBudget}
        onSetAutoCompact={setAutoCompact}
        onRefreshUsage={refreshUsage}
        onNewSession={newSession}
        onResumeSession={resumeSession}
        onShowPersona={() => setShowPersona(true)}
        onDisconnect={clear}
      />
      <main className="main main-work">
        <div className="mode-tabs">
          <button
            className={`mode-tab ${view === 'chat' ? 'on' : ''}`}
            onClick={() => setView('chat')}
          >
            <Icon name="chat" />
            CHAT
          </button>
          <button
            className={`mode-tab ${view === 'squad' ? 'on' : ''}`}
            onClick={() => setView('squad')}
          >
            <Icon name="squad" />
            AGENTS
          </button>
          <button
            className={`mode-tab ${view === 'cost' ? 'on' : ''}`}
            onClick={() => setView('cost')}
          >
            <Icon name="cost" />
            COST
          </button>
          <button
            className={`mode-tab ${view === 'extend' ? 'on' : ''}`}
            onClick={() => setView('extend')}
          >
            <Icon name="extend" />
            EXTEND
          </button>
          <button
            className={`mode-tab ${view === 'guide' ? 'on' : ''}`}
            onClick={() => setView('guide')}
          >
            <Icon name="guide" />
            GUIDE
          </button>
        </div>
        <div className="view-body">
          <div className="view-pane chat-pane" style={{ display: view === 'chat' ? 'flex' : 'none' }}>
            <div className="chat-tabs" role="tablist">
              {tabs.map((t) => (
                <div
                  key={t.key}
                  className={`chat-tab ${t.key === activeKey ? 'on' : ''}`}
                  onClick={() => setActiveKey(t.key)}
                  title={tabTitle(t)}
                >
                  <span className="chat-tab-title">{tabTitle(t)}</span>
                  {tabs.length > 1 && (
                    <button
                      className="chat-tab-x"
                      title="Close conversation"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(t.key)
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button
                className="chat-tab-new"
                title="New conversation (isolated workspace)"
                disabled={tabs.length >= MAX_TABS}
                onClick={newSession}
              >
                ＋
              </button>
            </div>
            {/* One Composer per open tab, all kept mounted so background
                conversations keep streaming when you switch (each runs in its own
                workspace). Only the active tab is shown. */}
            {tabs.map((t) => (
              <div
                key={t.key}
                className="chat-tab-pane"
                style={{ display: t.key === activeKey ? 'flex' : 'none' }}
              >
                <Composer
                  model={model}
                  permission={permission}
                  effort={effortOption(effort)}
                  commands={commands}
                  models={models}
                  maxTurnsByModel={maxTurnsByModel}
                  maxBudget={maxBudget}
                  autoCompact={autoCompact}
                  costSaver={costSaver}
                  onResult={onResult}
                  workspaceId={t.key}
                  isActive={t.key === activeKey}
                  sessionId={t.sessionId}
                  sessionKey={t.sessionKey}
                  onSession={(id) => setTabSession(t.key, id)}
                  onSetModel={chooseModel}
                  onSetEffort={chooseEffort}
                  onSetPermission={setPermission}
                  onNewSession={() => resetTab(t.key)}
                />
              </div>
            ))}
          </div>
          <div className="view-pane" style={{ display: view === 'squad' ? 'flex' : 'none' }}>
            <SquadView />
          </div>
          <div className="view-pane" style={{ display: view === 'cost' ? 'flex' : 'none' }}>
            <CostView />
          </div>
          <div className="view-pane" style={{ display: view === 'extend' ? 'flex' : 'none' }}>
            <ExtendView
              onCommandsChanged={refreshCaps}
              mcpStatus={mcpServers}
              onMcpChanged={refreshCaps}
            />
          </div>
          <div className="view-pane" style={{ display: view === 'guide' ? 'flex' : 'none' }}>
            <GuideView onGoto={setView} />
          </div>
        </div>
      </main>
      {paletteOpen && (
        <CommandPalette actions={paletteActions} onClose={() => setPaletteOpen(false)} />
      )}
      {shortcutsOpen && <ShortcutsHelp onClose={() => setShortcutsOpen(false)} />}
      {showPersona && (
        <PersonaModal
          initial={persona ?? { enabled: false, mode: 'append', text: '' }}
          onClose={() => setShowPersona(false)}
          onSave={async (p) => {
            const saved = await window.forge.persona.set(p)
            setPersonaState(saved)
            setShowPersona(false)
          }}
        />
      )}
    </div>
  )
}

/* EXTEND (console) → ./components/extend/ExtendView (+ Skills/Commands/Hooks/Mcp/Agents/Plugins panels) */

// RunMeta, Block → ./types

// toolIcon, toolArgObj, toolArg → ./lib/format · parseTodos → ./lib/blocks (Todo → ./types)

/* CHAT leaf views → ./components/chat/ (TodoList, TodoBar, HistoryView, BlockView, TurnView, PermissionModal, QuestionModal) */

/**
 * Context window for a model id or alias. Most current models ship a 1M window
 * natively (Sonnet 4.5/4.6, Opus 4.5+, Fable/Mythos) — only Haiku and the older
 * Opus 4.0/4.1 are 200k. The `[1m]` suffix (subscription 1M tier) is always 1M.
 * Unknown ids default to 200k (the safe, conservative side for compaction).
 */
// ctxWindow → ./lib/format

// CLIENT_COMMANDS → ./lib/constants

/* SQUAD (multi-agent) → ./components/squad/SquadView */

/* CHAT composer + live transcript → ./components/chat/Composer */
