import { useEffect, useMemo, useState, type JSX } from 'react'
import AuthGate from './components/AuthGate'
import Icon from './components/Icon'
import Sidebar from './components/Sidebar'
import TitleBar from './components/TitleBar'
import ExtendView from './components/extend/ExtendView'
import Composer from './components/chat/Composer'
import SquadView from './components/squad/SquadView'
import DebugSidePanel from './components/chat/DebugSidePanel'
import CostView from './components/cost/CostView'
import GuideView from './components/guide/GuideView'
import PersonaModal from './components/persona/PersonaModal'
import CommandPalette, { type PaletteAction } from './components/palette/CommandPalette'
import ShortcutsHelp from './components/ShortcutsHelp'
import ConversationSearch from './components/ConversationSearch'
import WorkspaceFiles from './components/WorkspaceFiles'
import Settings from './components/Settings'
import { ConfirmProvider, useConfirm } from './components/ConfirmDialog'
import type {
  AuthMode,
  AuthStatus,
  Permission,
  Effort,
  ModelInfo,
  SlashCommand,
  Capabilities,
  SessionInfo,
  UsageInfo,
  Persona,
  EffortLabel,
  LazySetting
} from './types'
import { EFFORTS, PERMS, effortOption } from './lib/constants'
import { resolveMaxTurns } from './lib/format'
import { loadJson, saveJson } from './lib/storage'
import { useChatTabs, MAX_TABS, type ChatTab } from './components/chat/useChatTabs'
import { useDebugStream } from './lib/useDebugStream'

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
  const {
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
  } = useChatTabs({ sessions, onExitCostSaver: () => setCostSaver(false) })
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
  // Lazy mode (ponytail): a persistent code-minimalism discipline injected on
  // every run at the chosen intensity. 'off' = inactive (keyword still works).
  const [lazyLevel, setLazyLevel] = useState<LazySetting>(() => loadJson('forge-lazy-level', 'off'))
  // Persist the LIMITS settings whenever they change.
  useEffect(() => saveJson('forge-max-turns', maxTurnsByModel), [maxTurnsByModel])
  useEffect(() => saveJson('forge-max-budget', maxBudget), [maxBudget])
  useEffect(() => saveJson('forge-auto-compact', autoCompact), [autoCompact])
  useEffect(() => saveJson('forge-lazy-level', lazyLevel), [lazyLevel])
  const [view, setView] = useState<'chat' | 'squad' | 'cost' | 'extend' | 'guide'>('chat')
  // Debug stream — starts collecting agent events immediately on login (zero extra
  // tokens). Data flows to SquadView (Inspect button) and DebugSidePanel (chat).
  const { runs: debugRuns, currentRunId: debugRunId } = useDebugStream()
  const [debugPanelOpen, setDebugPanelOpen] = useState(false)
  const [persona, setPersonaState] = useState<Persona | null>(null)
  const [showPersona, setShowPersona] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [searchAllOpen, setSearchAllOpen] = useState(false)
  const [wsFilesOpen, setWsFilesOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const confirm = useConfirm()
  // Pinned conversations (local — sorted first in the sidebar). The SDK owns the
  // title (renameSession) and the transcript (deleteSession); pinning is Forge-only.
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(loadJson<string[]>('forge-pinned', [])))
  useEffect(() => saveJson('forge-pinned', [...pinned]), [pinned])
  function togglePin(id: string): void {
    setPinned((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  async function renameSessionTitle(id: string, title: string): Promise<void> {
    const t = title.trim()
    if (!t) return
    await window.forge.agent.renameSession(id, t)
    refreshSessions()
  }
  async function deleteSessionAction(id: string): Promise<void> {
    const ok = await confirm({
      message: 'Delete this conversation? Its saved transcript is permanently removed.',
      danger: true,
      confirmLabel: 'Delete'
    })
    if (!ok) return
    await window.forge.agent.deleteSession(id)
    setPinned((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    // Reset any open tab showing the deleted conversation to a fresh one.
    clearTabsForSession(id)
    // Drop its persisted workspace mapping + per-chat overrides (no map growth).
    forgetSession(id)
    refreshSessions()
  }

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
  // Resolve the effort actually sent for a tab: its per-chat override else the
  // global, clamped to what the tab's effective model supports (so a model that
  // has no effort control — e.g. Haiku — never receives an unsupported level,
  // which would error). Returns undefined (= AUTO / no effort param).
  function resolveRunEffort(t: ChatTab): Effort | undefined {
    const label = t.effort ?? effort
    if (label === 'AUTO') return undefined
    const mv = t.model ?? model
    const levels = models.find((m) => m.value === mv)?.supportedEffortLevels
    if (levels && !levels.includes(label.toLowerCase())) return undefined
    return effortOption(label)
  }
  // Switching to a model that can't do the current effort (e.g. Haiku) snaps
  // the selection back to AUTO so the run doesn't carry an unsupported level.
  useEffect(() => {
    if (!effortSupported(effort)) setEffort('AUTO')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, modelEfforts, effort])

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
        id: 'search-all',
        section: 'Session',
        label: 'Search all conversations…',
        keywords: 'find across history transcript',
        run: () => setSearchAllOpen(true)
      },
      {
        id: 'workspace-files',
        section: 'Session',
        label: 'Workspace files (this conversation)…',
        keywords: 'edits diff files changed',
        run: () => setWsFilesOpen(true)
      },
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
        id: 'settings',
        section: 'Help',
        label: 'Settings…',
        keywords: 'preferences limits pet data',
        run: () => setSettingsOpen(true)
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
        pinned={pinned}
        onTogglePin={togglePin}
        onRenameSession={renameSessionTitle}
        onDeleteSession={deleteSessionAction}
        onSearchAll={() => setSearchAllOpen(true)}
        onShowPersona={() => setShowPersona(true)}
        onOpenSettings={() => setSettingsOpen(true)}
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
              <button
                className="chat-tab-new"
                title="Workspace files edited in this conversation"
                onClick={() => setWsFilesOpen(true)}
              >
                ⌗
              </button>
              {/* Debug monitor toggle: opens DebugSidePanel to the right of chat */}
              <button
                className={`chat-tab-new dbg-toggle${debugPanelOpen ? ' dbg-toggle-on' : ''}`}
                title={debugPanelOpen ? 'Close debug monitor' : 'Debug monitor: live thinking + tool I/O (zero extra tokens)'}
                aria-label="Toggle debug monitor"
                onClick={() => setDebugPanelOpen((v) => !v)}
              >
                <Icon name="inspect" />
              </button>
            </div>
            {/* chat-body: row flex so DebugSidePanel can sit to the right of the
                Composer panes without disrupting the column layout above. */}
            <div className="chat-body">
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
                    model={t.model ?? model}
                    permission={permission}
                    effort={resolveRunEffort(t)}
                    globalModel={model}
                    tabModel={t.model}
                    globalEffort={effort}
                    tabEffort={t.effort}
                    commands={commands}
                    models={models}
                    maxTurnsByModel={maxTurnsByModel}
                    maxBudget={maxBudget}
                    autoCompact={autoCompact}
                    costSaver={costSaver}
                    lazyLevel={lazyLevel}
                    onResult={onResult}
                    workspaceId={t.key}
                    isActive={t.key === activeKey}
                    convPersona={t.persona}
                    sessionId={t.sessionId}
                    sessionKey={t.sessionKey}
                    onSession={(id) => setTabSession(t.key, id)}
                    onSetModel={(id) => setTabModel(t.key, id)}
                    onSetConvPersona={(text) => setTabPersona(t.key, text)}
                    onSetEffort={(l) => setTabEffort(t.key, l)}
                    onSetPermission={setPermission}
                    onNewSession={() => resetTab(t.key)}
                  />
                </div>
              ))}
              {/* Debug side panel — mounts alongside the active Composer */}
              {debugPanelOpen && (
                <DebugSidePanel
                  runs={debugRuns}
                  currentRunId={debugRunId}
                  onClose={() => setDebugPanelOpen(false)}
                />
              )}
            </div>
          </div>
          <div className="view-pane" style={{ display: view === 'squad' ? 'flex' : 'none' }}>
            <SquadView debugRuns={debugRuns} />
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
      {searchAllOpen && (
        <ConversationSearch onOpen={resumeSession} onClose={() => setSearchAllOpen(false)} />
      )}
      {wsFilesOpen && activeTab && (
        <WorkspaceFiles workspaceId={activeTab.key} onClose={() => setWsFilesOpen(false)} />
      )}
      {settingsOpen && (
        <Settings
          maxBudget={maxBudget}
          onSetMaxBudget={setMaxBudget}
          autoCompact={autoCompact}
          onSetAutoCompact={setAutoCompact}
          lazyLevel={lazyLevel}
          onSetLazyLevel={setLazyLevel}
          onClose={() => setSettingsOpen(false)}
        />
      )}
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
