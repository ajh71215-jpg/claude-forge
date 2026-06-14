import { useEffect, useState, type JSX } from 'react'
import AuthGate from './components/AuthGate'
import Icon from './components/Icon'
import TitleBar from './components/TitleBar'
import ExtendView from './components/extend/ExtendView'
import Composer from './components/chat/Composer'
import SquadView from './components/squad/SquadView'
import PersonaModal from './components/persona/PersonaModal'
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
import { cacheHitPercent, fmtTokens, mcpStatusClass, methodLabel, usageShortLabel } from './lib/format'

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
  const [maxTurns, setMaxTurns] = useState(20)
  const [maxBudget, setMaxBudget] = useState(0) // 0 = off
  const [autoCompact, setAutoCompact] = useState(false)
  const [costSaver, setCostSaver] = useState(false)
  const [view, setView] = useState<'chat' | 'squad' | 'extend'>('chat')
  const [persona, setPersonaState] = useState<Persona | null>(null)
  const [showPersona, setShowPersona] = useState(false)

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

  // Prompt-cache hit rate via the single validated helper (lever 1) instead of an
  // inline duplicate — read ÷ (fresh + read + write). Numerically identical to the
  // old promptTotal-based calc (contextTokens == fresh+read+write per turn), now
  // also explicitly accounting for the write side.
  const cacheHitPct = cacheHitPercent(usage.input, usage.cacheRead, usage.cacheWrite) ?? 0

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

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">⚒</span> FORGE
        </div>

        <div className="conn">
          <div className="conn-dot" />
          <div>
            <div className="conn-label">CONNECTED</div>
            <div className="conn-method">{methodLabel(mode)}</div>
          </div>
        </div>

        <label className={`saver-toggle ${costSaver ? 'on' : ''}`}>
          <input
            type="checkbox"
            checked={costSaver}
            onChange={(e) => setCostSaver(e.target.checked)}
          />
          <div>
            <div className="saver-title">
              <Icon name="bolt" className="saver-icon" /> COST-SAVER
            </div>
            <div className="saver-desc">Auto-route each task by difficulty</div>
          </div>
        </label>

        <div className={`selector ${costSaver ? 'dim' : ''}`}>
          <div className="selector-label">MODEL</div>
          <div className="model-list">
            {caps === null && <div className="selector-hint">loading models…</div>}
            {caps && models.length === 0 && <div className="selector-hint">no models available</div>}
            {model && models.length > 0 && !models.some((m) => m.value === model) && (
              <button className="model-card on" onClick={() => chooseModel(model)}>
                <div className="model-name">{model}</div>
                <div className="model-desc">custom model id (via /model)</div>
              </button>
            )}
            {models.map((m) => (
              <button
                key={m.value}
                className={`model-card ${!costSaver && model === m.value ? 'on' : ''}`}
                onClick={() => chooseModel(m.value)}
              >
                <div className="model-name">{m.displayName}</div>
                {m.description && <div className="model-desc">{m.description}</div>}
              </button>
            ))}
          </div>
          {costSaver && (
            <div className="selector-hint">auto-routed per task → haiku · sonnet · opus</div>
          )}
        </div>

        <div className={`selector ${costSaver ? 'dim' : ''}`}>
          <div className="selector-label">EFFORT</div>
          <div className="effort-grid">
            {EFFORTS.map((e) => {
              const ok = effortSupported(e)
              return (
                <button
                  key={e}
                  className={`effort-cell ${!costSaver && effort === e ? 'on' : ''}`}
                  disabled={!ok}
                  title={ok ? undefined : `${model} has no separate effort control`}
                  onClick={() => chooseEffort(e)}
                >
                  {e}
                </button>
              )
            })}
          </div>
          {costSaver ? (
            <div className="selector-hint">auto-routed per task difficulty</div>
          ) : modelEfforts && modelEfforts.length === 0 ? (
            <div className="selector-hint">{model} runs at a fixed effort</div>
          ) : (
            (effort === 'XHIGH' || effort === 'MAX') && (
              <div className="effort-warn">⚠ high token use</div>
            )
          )}
        </div>

        <div className="selector">
          <div className="selector-label">LIMITS</div>
          <div className="limit-row">
            <label htmlFor="maxturns">max turns</label>
            <input
              id="maxturns"
              type="number"
              min={1}
              max={200}
              value={maxTurns}
              onChange={(e) => setMaxTurns(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div className="limit-row">
            <label htmlFor="maxbudget">max $ / run</label>
            <input
              id="maxbudget"
              type="number"
              min={0}
              step={0.5}
              placeholder="off"
              value={maxBudget || ''}
              onChange={(e) => setMaxBudget(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <label className="limit-check">
            <input
              type="checkbox"
              checked={autoCompact}
              onChange={(e) => setAutoCompact(e.target.checked)}
            />
            auto-compact at 80% context
          </label>
        </div>

        <div className="selector">
          <div className="selector-label">PERMISSIONS</div>
          <div className="perm-list">
            {PERMS.map((p) => (
              <button
                key={p.id}
                className={`perm-card ${permission === p.id ? 'on' : ''}`}
                onClick={() => setPermission(p.id)}
              >
                <div className="perm-title">{p.title}</div>
                <div className="perm-desc">{p.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="selector">
          <div className="selector-head">
            <div className="selector-label">AGENT</div>
            <button className="mini-btn" onClick={() => setShowPersona(true)}>
              ✎ Customize
            </button>
          </div>
          <button className="persona-card" onClick={() => setShowPersona(true)}>
            <div className="persona-row">
              <span
                className={`persona-dot ${persona?.enabled && persona.text.trim() ? 'on' : ''}`}
              />
              <span className="persona-state">
                {persona?.enabled && persona.text.trim()
                  ? 'Custom behavior active'
                  : 'Default behavior'}
              </span>
            </div>
            {persona?.enabled && persona.text.trim() ? (
              <div className="persona-preview">
                {persona.text.trim().slice(0, 90)}
                {persona.text.trim().length > 90 ? '…' : ''}
              </div>
            ) : (
              <div className="persona-preview muted">
                Click to give the agent custom instructions
              </div>
            )}
          </button>
        </div>

        <div className="selector">
          <div className="selector-label">MCP SERVERS</div>
          <div className="mcp-list">
            {caps === null && <div className="selector-hint">…</div>}
            {caps && mcpServers.length === 0 && <div className="selector-hint">none configured</div>}
            {mcpServers.map((s) => (
              <div className="mcp-row" key={s.name} title={s.url ?? ''}>
                <span className={`mcp-dot ${mcpStatusClass(s.status)}`} />
                <span className="mcp-name">{s.name.replace(/^claude\.ai /, '')}</span>
                <span className="mcp-status">{s.status}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="selector">
          <div className="selector-head">
            <div className="selector-label">CONVERSATIONS</div>
            <button className="mini-btn" onClick={newSession}>
              + New
            </button>
          </div>
          <div className="conv-list">
            {sessions.length === 0 && <div className="selector-hint">no saved conversations</div>}
            {sessions.slice(0, 12).map((s) => (
              <button
                key={s.sessionId}
                className={`conv-row ${sessionId === s.sessionId ? 'on' : ''}`}
                title={s.firstPrompt ?? s.title}
                onClick={() => resumeSession(s.sessionId)}
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>

        <div className="selector session">
          <div className="selector-head">
            <div className="selector-label">PLAN USAGE</div>
            <div className="usage-head-right">
              {caps?.account?.subscriptionType && (
                <span className="plan-badge">{caps.account.subscriptionType}</span>
              )}
              <button className="mini-btn" title="Refresh usage" onClick={refreshUsage}>
                ↻
              </button>
            </div>
          </div>
          {!subUsage && <div className="selector-hint">…</div>}
          {subUsage && subUsage.entries.length === 0 && (
            <div className="selector-hint">usage unavailable</div>
          )}
          {subUsage?.entries.map((e) => (
            <div className="usage-entry" key={e.label}>
              <div className="usage-top">
                <span className="usage-label">{usageShortLabel(e.label)}</span>
                <span className="usage-pct">{e.percent}%</span>
              </div>
              <div className="usage-bar">
                <div
                  className={`usage-fill ${e.percent >= 80 ? 'hot' : ''}`}
                  style={{ width: `${Math.min(100, e.percent)}%` }}
                />
              </div>
              <div className="usage-reset">resets {e.resets}</div>
            </div>
          ))}
        </div>

        <div className="selector">
          <div className="selector-label">TOKENS · THIS SESSION</div>
          <div className="tok-grid">
            <div className="tok-cell">
              <div className="tok-num">{fmtTokens(usage.input)}</div>
              <div className="tok-lbl">fresh in</div>
            </div>
            <div className="tok-cell">
              <div className="tok-num">{fmtTokens(usage.output)}</div>
              <div className="tok-lbl">out</div>
            </div>
          </div>
          <div className="usage-entry tok-cache">
            <div className="usage-top">
              <span className="usage-label">cache reuse</span>
              <span className="usage-pct">{cacheHitPct}%</span>
            </div>
            <div className="usage-bar">
              <div className="usage-fill" style={{ width: cacheHitPct + '%' }} />
            </div>
            <div className="usage-reset">
              {fmtTokens(usage.cacheRead)} read · {fmtTokens(usage.cacheWrite)} written of{' '}
              {fmtTokens(usage.promptTotal)} input tokens
            </div>
          </div>
          <div className="session-meta local-cost">
            ${usage.costUsd.toFixed(4)} · {usage.runs} run{usage.runs === 1 ? '' : 's'}
          </div>
        </div>

        <button className="ghost" onClick={clear}>
          Disconnect
        </button>
      </aside>
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
            SQUAD
          </button>
          <button
            className={`mode-tab ${view === 'extend' ? 'on' : ''}`}
            onClick={() => setView('extend')}
          >
            <Icon name="extend" />
            EXTEND
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
              maxTurns={maxTurns}
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
          <div className="view-pane" style={{ display: view === 'extend' ? 'flex' : 'none' }}>
            <ExtendView
              onCommandsChanged={refreshCaps}
              mcpStatus={mcpServers}
              onMcpChanged={refreshCaps}
            />
          </div>
        </div>
      </main>
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
