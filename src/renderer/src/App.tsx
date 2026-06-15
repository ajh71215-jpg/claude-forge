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
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionKey, setSessionKey] = useState(0)
  // Per-model max turns. Each model keeps its own override; unset models fall
  // back to defaultMaxTurns(model). Keyed by model id ('default' = the active
  // account default model).
  const [maxTurnsByModel, setMaxTurnsByModel] = useState<Record<string, number>>({})
  const maxTurns = resolveMaxTurns(maxTurnsByModel, model)
  const setMaxTurns = (n: number): void =>
    setMaxTurnsByModel((m) => ({ ...m, [model]: Math.max(1, n) }))
  const [maxBudget, setMaxBudget] = useState(0) // 0 = off
  const [autoCompact, setAutoCompact] = useState(false)
  const [costSaver, setCostSaver] = useState(false)
  const [view, setView] = useState<'chat' | 'squad' | 'cost' | 'extend' | 'guide'>('chat')
  const [persona, setPersonaState] = useState<Persona | null>(null)
  const [showPersona, setShowPersona] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

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
    // /usage subprocess spawn per message).
    const timer = window.setInterval(refreshUsage, 90_000)
    return () => window.clearInterval(timer)
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

  function newSession(): void {
    setSessionId(null)
    setSessionKey((k) => k + 1)
  }
  function resumeSession(id: string): void {
    setSessionId(id)
    setSessionKey((k) => k + 1)
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
          <div className="view-pane" style={{ display: view === 'chat' ? 'flex' : 'none' }}>
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
              sessionId={sessionId}
              sessionKey={sessionKey}
              onSession={setSessionId}
              onSetModel={chooseModel}
              onSetEffort={chooseEffort}
              onSetPermission={setPermission}
              onNewSession={newSession}
            />
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
