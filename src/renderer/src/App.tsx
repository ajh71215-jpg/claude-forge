import { useEffect, useRef, useState, type JSX } from 'react'
import AuthGate from './components/AuthGate'
import Md from './components/Md'

export type AuthMode = 'subscription' | 'oauth-token' | 'api-key'
export interface AuthStatus {
  mode: AuthMode | null
  hasExistingLogin: boolean
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

function TitleBar(): JSX.Element {
  return (
    <div className="titlebar">
      <div className="titlebar-brand">
        <span className="brand-mark">⚒</span> CLAUDE FORGE
      </div>
      <div className="titlebar-controls">
        <button className="tb-btn" title="Minimize" onClick={() => window.forge.window.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button className="tb-btn" title="Maximize" onClick={() => window.forge.window.maximize()}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button className="tb-btn close" title="Close" onClick={() => window.forge.window.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" />
            <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function methodLabel(mode: AuthMode): string {
  switch (mode) {
    case 'subscription':
      return 'Claude subscription · existing login'
    case 'oauth-token':
      return 'Claude subscription · setup-token'
    case 'api-key':
      return 'Anthropic API key'
  }
}

type Effort = import('../../main/agent').Effort
type Permission = import('../../main/agent').Permission
type ModelInfo = import('../../main/agent').ModelInfo
type SlashCommand = import('../../main/agent').SlashCommand
type Capabilities = import('../../main/agent').Capabilities
type SessionInfo = import('../../main/agent').SessionInfo
type UsageInfo = import('../../main/agent').UsageInfo
type TranscriptItem = import('../../main/agent').TranscriptItem
type Attachment = import('../../main/agent').Attachment
type AgentEvent = import('../../main/agent').AgentEvent
type Persona = import('../../main/agent').Persona
type SkillMeta = import('../../main/skills').SkillMeta
type SkillDetail = import('../../main/skills').SkillDetail
type CommandMeta = import('../../main/commands').CommandMeta
type HookRule = import('../../main/hooks').HookRule
type McpServer = import('../../main/agent').McpServer
type McpServerEntry = import('../../main/mcp').McpServerEntry
type McpTransport = import('../../main/mcp').McpTransport
type AgentMeta = import('../../main/agents').AgentMeta
type PluginEntry = import('../../main/plugins').PluginEntry

type EffortLabel = 'AUTO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH' | 'MAX'
const EFFORTS: EffortLabel[] = ['AUTO', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX']

function effortOption(label: EffortLabel): Effort | undefined {
  return label === 'AUTO' ? undefined : (label.toLowerCase() as Effort)
}

const PERMS: { id: Permission; title: string; desc: string }[] = [
  { id: 'plan', title: 'PLAN', desc: 'read-only, propose a plan' },
  { id: 'ask', title: 'ASK', desc: 'approve each tool use' },
  { id: 'acceptEdits', title: 'AUTO-EDIT', desc: 'file edits auto-approved' },
  { id: 'bypassPermissions', title: 'YOLO', desc: 'everything auto-approved' }
]

function mcpStatusClass(status: string): string {
  if (status === 'connected') return 'ok'
  if (status === 'pending' || status === 'connecting') return 'pending'
  if (status === 'needs-auth') return 'warn'
  if (status === 'failed' || status === 'error') return 'err'
  return ''
}

function fmtTokens(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)
}

function usageShortLabel(label: string): string {
  const l = label.toLowerCase()
  if (l.startsWith('session')) return 'Session'
  if (l.includes('sonnet')) return 'Week · Sonnet'
  if (l.startsWith('week')) return 'Week'
  return label
}

const PERSONA_PRESETS: { label: string; text: string }[] = [
  { label: 'Korean', text: '항상 한국어로 답변하세요. 코드 주석도 한국어로 작성합니다.' },
  { label: 'Concise', text: 'Be concise. Prefer short, direct answers with minimal preamble.' },
  {
    label: 'Senior reviewer',
    text: 'Act as a meticulous senior engineer: call out edge cases, risks, and suggest tests before finishing.'
  },
  { label: 'Explain', text: 'Explain your reasoning step by step and teach as you go.' }
]

/** Editor panel for the agent's custom behavior (system-prompt persona). */
function PersonaModal({
  initial,
  onClose,
  onSave
}: {
  initial: Persona
  onClose: () => void
  onSave: (p: Persona) => void
}): JSX.Element {
  const [enabled, setEnabled] = useState(initial.enabled)
  const [pmode, setPmode] = useState<Persona['mode']>(initial.mode)
  const [text, setText] = useState(initial.text)

  function addPreset(t: string): void {
    setText((prev) => (prev.trim() ? prev.trim() + '\n' + t : t))
    setEnabled(true)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal persona-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">AGENT BEHAVIOR</div>

        <label className={`saver-toggle ${enabled ? 'on' : ''}`}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <div>
            <div className="saver-title">Enable custom instructions</div>
            <div className="saver-desc">Applied to every run in this app</div>
          </div>
        </label>

        <div className="persona-mode">
          <button
            className={`persona-mode-btn ${pmode === 'append' ? 'on' : ''}`}
            onClick={() => setPmode('append')}
          >
            <div className="pm-title">APPEND</div>
            <div className="pm-desc">Keep the default agent and add yours · recommended</div>
          </button>
          <button
            className={`persona-mode-btn ${pmode === 'replace' ? 'on' : ''}`}
            onClick={() => setPmode('replace')}
          >
            <div className="pm-title">REPLACE</div>
            <div className="pm-desc">Fully custom system prompt · advanced</div>
          </button>
        </div>

        <div className="persona-presets">
          {PERSONA_PRESETS.map((p) => (
            <button key={p.label} className="persona-chip" onClick={() => addPreset(p.text)}>
              + {p.label}
            </button>
          ))}
        </div>

        <textarea
          className="persona-text"
          placeholder="e.g. Always answer in Korean. Be concise. Prefer functional style and add tests…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          autoFocus
        />

        <div className="persona-note">
          Steers the agent&apos;s persona, tone and workflow. The model&apos;s own safety training
          still applies.
        </div>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={() => onSave({ enabled, mode: pmode, text })}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

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
    contextTokens?: number
  }): void {
    setUsage((u) => ({
      costUsd: u.costUsd + (r.costUsd ?? 0),
      input: u.input + (r.inputTokens ?? 0),
      output: u.output + (r.outputTokens ?? 0),
      runs: u.runs + 1,
      cacheRead: u.cacheRead + (r.cacheReadTokens ?? 0),
      promptTotal: u.promptTotal + (r.contextTokens ?? 0)
    }))
    refreshSessions()
  }

  const cacheHitPct = usage.promptTotal > 0 ? Math.round((usage.cacheRead / usage.promptTotal) * 100) : 0

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
  // Cost-saver forces a cheaper model + low effort for each run.
  const effModel = costSaver ? 'sonnet' : model
  const effEffort: EffortLabel = costSaver ? 'LOW' : effort

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
            <div className="saver-title">⚡ COST-SAVER</div>
            <div className="saver-desc">Force Sonnet + low effort</div>
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
          {costSaver && <div className="selector-hint">overridden by cost-saver → sonnet</div>}
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
            <div className="selector-hint">overridden by cost-saver → low</div>
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
              {fmtTokens(usage.cacheRead)} of {fmtTokens(usage.promptTotal)} prompt tokens from cache
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
            CHAT
          </button>
          <button
            className={`mode-tab ${view === 'squad' ? 'on' : ''}`}
            onClick={() => setView('squad')}
          >
            ⚔ SQUAD
          </button>
          <button
            className={`mode-tab ${view === 'extend' ? 'on' : ''}`}
            onClick={() => setView('extend')}
          >
            🧩 EXTEND
          </button>
        </div>
        <div className="view-body">
          <div className="view-pane" style={{ display: view === 'chat' ? 'flex' : 'none' }}>
            <Composer
              model={effModel}
              permission={permission}
              effort={effortOption(effEffort)}
              commands={commands}
              models={models}
              maxTurns={maxTurns}
              maxBudget={maxBudget}
              autoCompact={autoCompact}
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
            <SquadView
              models={models}
              defaults={{ model, effort, permission }}
              maxTurns={maxTurns}
              maxBudget={maxBudget}
              onResult={onResult}
            />
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

/* ============================ EXTEND (console) ============================ */

type ExtendSection = 'skills' | 'commands' | 'hooks' | 'mcp' | 'agents' | 'plugins'

const EXTEND_SECTIONS: { id: ExtendSection; label: string; icon: string; ready: boolean }[] = [
  { id: 'skills', label: 'Skills', icon: '🧩', ready: true },
  { id: 'commands', label: 'Commands', icon: '⌨', ready: true },
  { id: 'hooks', label: 'Hooks', icon: '🪝', ready: true },
  { id: 'mcp', label: 'MCP', icon: '🔌', ready: true },
  { id: 'agents', label: 'Agents', icon: '🤖', ready: true },
  { id: 'plugins', label: 'Plugins', icon: '📦', ready: true }
]

/** The EXTEND tab: a console over the filesystem `.claude/` extension points. */
function ExtendView({
  onCommandsChanged,
  mcpStatus,
  onMcpChanged
}: {
  onCommandsChanged?: () => void
  mcpStatus: McpServer[]
  onMcpChanged?: () => void
}): JSX.Element {
  const [section, setSection] = useState<ExtendSection>('skills')
  const active = EXTEND_SECTIONS.find((s) => s.id === section)
  return (
    <div className="extend-view">
      <nav className="extend-nav">
        <div className="extend-nav-title">EXTEND</div>
        {EXTEND_SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`extend-nav-item ${section === s.id ? 'on' : ''}`}
            onClick={() => setSection(s.id)}
          >
            <span className="extend-nav-icon">{s.icon}</span>
            <span className="extend-nav-label">{s.label}</span>
            {!s.ready && <span className="extend-soon">soon</span>}
          </button>
        ))}
      </nav>
      <div className="extend-body">
        {section === 'skills' ? (
          <SkillsPanel />
        ) : section === 'commands' ? (
          <CommandsPanel onChanged={onCommandsChanged} />
        ) : section === 'hooks' ? (
          <HooksPanel />
        ) : section === 'mcp' ? (
          <McpPanel status={mcpStatus} onChanged={onMcpChanged} />
        ) : section === 'agents' ? (
          <AgentsPanel />
        ) : section === 'plugins' ? (
          <PluginsPanel onChanged={onMcpChanged} />
        ) : (
          <div className="extend-stub">
            <div className="extend-stub-icon">{active?.icon}</div>
            <div className="extend-stub-title">{active?.label} — coming next</div>
            <div className="extend-stub-desc">
              This panel lands in a later roadmap phase. Skills is live now.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface SkillDraft {
  /** Set when editing an existing skill (the previous dir name). */
  originalName?: string
  name: string
  description: string
  body: string
}

const SKILL_TEMPLATE = `# Overview
Describe what this skill does and the steps the agent should follow.

## When to use
- Trigger conditions / example requests.

## Steps
1. ...
2. ...
`

/** Skills manager — list / toggle / create / edit / delete `.claude/skills`. */
function SkillsPanel(): JSX.Element {
  const [skills, setSkills] = useState<SkillMeta[] | null>(null)
  const [editing, setEditing] = useState<SkillDraft | null>(null)
  const [busy, setBusy] = useState(false)

  function refresh(): void {
    window.forge.skills
      .list()
      .then(setSkills)
      .catch(() => setSkills([]))
  }
  useEffect(refresh, [])

  async function toggle(s: SkillMeta): Promise<void> {
    setBusy(true)
    try {
      setSkills(await window.forge.skills.toggle(s.name, !s.enabled))
    } finally {
      setBusy(false)
    }
  }
  async function openEdit(name: string): Promise<void> {
    const d = await window.forge.skills.read(name)
    if (d)
      setEditing({ originalName: d.name, name: d.name, description: d.description, body: d.body })
  }
  function openNew(): void {
    setEditing({ name: '', description: '', body: SKILL_TEMPLATE })
  }
  async function remove(s: SkillMeta): Promise<void> {
    if (!window.confirm(`Delete skill "${s.name}"? This permanently removes its files.`)) return
    setBusy(true)
    try {
      setSkills(await window.forge.skills.delete(s.name))
    } finally {
      setBusy(false)
    }
  }

  const enabledCount = skills?.filter((s) => s.enabled).length ?? 0

  return (
    <div className="skills-panel">
      <div className="skills-head">
        <div>
          <div className="skills-title">SKILLS</div>
          <div className="skills-sub">
            Authored in <code>.claude/skills</code> · toggles control which ones the model can use
            {skills && skills.length > 0 ? ` · ${enabledCount}/${skills.length} on` : ''}
          </div>
        </div>
        <button className="primary skills-new" onClick={openNew}>
          + New skill
        </button>
      </div>

      {skills === null ? (
        <div className="skills-empty">loading…</div>
      ) : skills.length === 0 ? (
        <div className="skills-empty">
          <div className="skills-empty-icon">🧩</div>
          <div className="skills-empty-title">No skills yet</div>
          <div className="skills-empty-desc">
            Create one to give the agent a reusable, on-demand capability — discovered from
            <code>.claude/skills</code> on every run.
          </div>
        </div>
      ) : (
        <div className="skill-list">
          {skills.map((s) => (
            <div key={s.name} className={`skill-row ${s.enabled ? '' : 'off'}`}>
              <button
                className={`skill-switch ${s.enabled ? 'on' : ''}`}
                title={s.enabled ? 'Enabled — click to hide from the model' : 'Disabled — click to enable'}
                disabled={busy}
                onClick={() => toggle(s)}
              >
                <span className="skill-knob" />
              </button>
              <button className="skill-main" onClick={() => openEdit(s.name)}>
                <div className="skill-name">{s.name}</div>
                <div className="skill-desc">{s.description || 'No description'}</div>
              </button>
              <div className="skill-actions">
                <button className="skill-act" onClick={() => openEdit(s.name)}>
                  Edit
                </button>
                <button className="skill-act danger" disabled={busy} onClick={() => remove(s)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <SkillEditor
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={(list) => {
            setSkills(list)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

function SkillEditor({
  draft,
  onClose,
  onSaved
}: {
  draft: SkillDraft
  onClose: () => void
  onSaved: (skills: SkillMeta[]) => void
}): JSX.Element {
  const isNew = !draft.originalName
  const [name, setName] = useState(draft.name)
  const [description, setDescription] = useState(draft.description)
  const [body, setBody] = useState(draft.body)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const nameOk = SKILL_NAME_RE.test(name.trim())

  async function save(): Promise<void> {
    if (!nameOk) return
    setSaving(true)
    setError(null)
    try {
      const res = await window.forge.skills.write({
        name: name.trim(),
        description,
        body,
        originalName: draft.originalName
      })
      if (res.ok) onSaved(res.skills)
      else setError(res.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal skill-editor" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{isNew ? 'NEW SKILL' : `EDIT · ${draft.originalName}`}</div>

        <label className="skill-field">
          <span className="skill-flabel">
            Name <span className="skill-hint">lowercase-hyphen id · the directory name</span>
          </span>
          <input
            className={`skill-input ${name && !nameOk ? 'bad' : ''}`}
            value={name}
            placeholder="pdf-export"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            autoFocus={isNew}
          />
        </label>

        <label className="skill-field">
          <span className="skill-flabel">
            Description <span className="skill-hint">tells the model when to reach for it</span>
          </span>
          <input
            className="skill-input"
            value={description}
            placeholder="Convert and export documents to PDF."
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <label className="skill-field">
          <span className="skill-flabel">
            Instructions <span className="skill-hint">Markdown body of SKILL.md</span>
          </span>
          <textarea
            className="skill-body"
            value={body}
            rows={11}
            spellCheck={false}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>

        {error && <div className="skill-error">{error}</div>}
        <div className="skill-note">
          Skills run real instructions locally. Saved to{' '}
          <code>.claude/skills/{name.trim() || 'name'}/SKILL.md</code>.
        </div>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!nameOk || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save skill'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface CommandDraft {
  originalName?: string
  name: string
  description: string
  argumentHint: string
  body: string
}

const COMMAND_TEMPLATE = `Summarize what the user wants using the arguments below.

User input: $ARGUMENTS
`

/** Custom slash-command manager — `.claude/commands/<name>.md`. */
function CommandsPanel({ onChanged }: { onChanged?: () => void }): JSX.Element {
  const [commands, setCommands] = useState<CommandMeta[] | null>(null)
  const [editing, setEditing] = useState<CommandDraft | null>(null)
  const [busy, setBusy] = useState(false)

  function refresh(): void {
    window.forge.commands
      .list()
      .then(setCommands)
      .catch(() => setCommands([]))
  }
  useEffect(refresh, [])

  async function openEdit(name: string): Promise<void> {
    const d = await window.forge.commands.read(name)
    if (d)
      setEditing({
        originalName: d.name,
        name: d.name,
        description: d.description,
        argumentHint: d.argumentHint ?? '',
        body: d.body
      })
  }
  function openNew(): void {
    setEditing({ name: '', description: '', argumentHint: '', body: COMMAND_TEMPLATE })
  }
  async function remove(c: CommandMeta): Promise<void> {
    if (!window.confirm(`Delete command "/${c.name}"? This removes its file.`)) return
    setBusy(true)
    try {
      setCommands(await window.forge.commands.delete(c.name))
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="skills-panel">
      <div className="skills-head">
        <div>
          <div className="skills-title">SLASH COMMANDS</div>
          <div className="skills-sub">
            Authored in <code>.claude/commands</code> · type <code>/name</code> in the composer ·
            body is a prompt template using <code>$ARGUMENTS</code>
          </div>
        </div>
        <button className="primary skills-new" onClick={openNew}>
          + New command
        </button>
      </div>

      {commands === null ? (
        <div className="skills-empty">loading…</div>
      ) : commands.length === 0 ? (
        <div className="skills-empty">
          <div className="skills-empty-icon">⌨</div>
          <div className="skills-empty-title">No custom commands yet</div>
          <div className="skills-empty-desc">
            Create reusable prompt templates — they appear in the composer slash menu on the next
            run.
          </div>
        </div>
      ) : (
        <div className="skill-list">
          {commands.map((c) => (
            <div key={c.name} className="skill-row">
              <button className="skill-main" onClick={() => openEdit(c.name)}>
                <div className="skill-name">
                  /{c.name}
                  {c.argumentHint ? <span className="cmd-hint">{c.argumentHint}</span> : null}
                </div>
                <div className="skill-desc">{c.description || 'No description'}</div>
              </button>
              <div className="skill-actions">
                <button className="skill-act" onClick={() => openEdit(c.name)}>
                  Edit
                </button>
                <button className="skill-act danger" disabled={busy} onClick={() => remove(c)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <CommandEditor
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={(list) => {
            setCommands(list)
            setEditing(null)
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}

function CommandEditor({
  draft,
  onClose,
  onSaved
}: {
  draft: CommandDraft
  onClose: () => void
  onSaved: (commands: CommandMeta[]) => void
}): JSX.Element {
  const isNew = !draft.originalName
  const [name, setName] = useState(draft.name)
  const [description, setDescription] = useState(draft.description)
  const [argumentHint, setArgumentHint] = useState(draft.argumentHint)
  const [body, setBody] = useState(draft.body)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const nameOk = SKILL_NAME_RE.test(name.trim())

  async function save(): Promise<void> {
    if (!nameOk) return
    setSaving(true)
    setError(null)
    try {
      const res = await window.forge.commands.write({
        name: name.trim(),
        description,
        argumentHint,
        body,
        originalName: draft.originalName
      })
      if (res.ok) onSaved(res.commands)
      else setError(res.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal skill-editor" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{isNew ? 'NEW COMMAND' : `EDIT · /${draft.originalName}`}</div>

        <label className="skill-field">
          <span className="skill-flabel">
            Name <span className="skill-hint">invoked as /name · lowercase-hyphen</span>
          </span>
          <input
            className={`skill-input ${name && !nameOk ? 'bad' : ''}`}
            value={name}
            placeholder="review-pr"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            autoFocus={isNew}
          />
        </label>

        <label className="skill-field">
          <span className="skill-flabel">
            Description <span className="skill-hint">shown in the slash menu</span>
          </span>
          <input
            className="skill-input"
            value={description}
            placeholder="Review the current PR diff and suggest fixes."
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <label className="skill-field">
          <span className="skill-flabel">
            Argument hint <span className="skill-hint">optional · e.g. [pr-number]</span>
          </span>
          <input
            className="skill-input"
            value={argumentHint}
            placeholder="[pr-number]"
            spellCheck={false}
            onChange={(e) => setArgumentHint(e.target.value)}
          />
        </label>

        <label className="skill-field">
          <span className="skill-flabel">
            Prompt template <span className="skill-hint">use $ARGUMENTS for the typed input</span>
          </span>
          <textarea
            className="skill-body"
            value={body}
            rows={9}
            spellCheck={false}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>

        {error && <div className="skill-error">{error}</div>}
        <div className="skill-note">
          Saved to <code>.claude/commands/{name.trim() || 'name'}.md</code>. New commands appear in
          the composer slash menu automatically.
        </div>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!nameOk || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save command'}
          </button>
        </div>
      </div>
    </div>
  )
}

const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'PreCompact',
  'Notification'
]

/** Hooks manager — shell-command hooks in `.claude/settings.json`. */
function HooksPanel(): JSX.Element {
  const [rules, setRules] = useState<HookRule[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.forge.hooks
      .list()
      .then(setRules)
      .catch(() => setRules([]))
  }, [])

  function patch(id: string, p: Partial<HookRule>): void {
    setRules((rs) => (rs ?? []).map((r) => (r.id === id ? { ...r, ...p } : r)))
    setDirty(true)
    setSaved(false)
  }
  function addRule(): void {
    setRules((rs) => [
      ...(rs ?? []),
      { id: crypto.randomUUID(), event: 'PreToolUse', matcher: '', command: '' }
    ])
    setDirty(true)
    setSaved(false)
  }
  function removeRule(id: string): void {
    setRules((rs) => (rs ?? []).filter((r) => r.id !== id))
    setDirty(true)
    setSaved(false)
  }
  async function save(): Promise<void> {
    if (!rules) return
    setSaving(true)
    try {
      const result = await window.forge.hooks.save(rules.filter((r) => r.command.trim()))
      setRules(result)
      setDirty(false)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const toolEvent = (ev: string): boolean => ev === 'PreToolUse' || ev === 'PostToolUse'

  return (
    <div className="skills-panel">
      <div className="skills-head">
        <div>
          <div className="skills-title">HOOKS</div>
          <div className="skills-sub">
            Shell commands in <code>.claude/settings.json</code> · fire on engine events ·{' '}
            <span className="hook-warn">they run real commands locally</span>
          </div>
        </div>
        <div className="hooks-head-actions">
          <button className="skill-act" onClick={addRule}>
            + Add hook
          </button>
          <button className="primary skills-new" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Saving…' : saved && !dirty ? 'Saved ✓' : 'Save hooks'}
          </button>
        </div>
      </div>

      {rules === null ? (
        <div className="skills-empty">loading…</div>
      ) : rules.length === 0 ? (
        <div className="skills-empty">
          <div className="skills-empty-icon">🪝</div>
          <div className="skills-empty-title">No hooks yet</div>
          <div className="skills-empty-desc">
            Add a hook to run a shell command when an event fires — e.g. a desktop notification on
            <code>Stop</code>, or a guard on <code>PreToolUse</code>.
          </div>
        </div>
      ) : (
        <div className="hook-list">
          {rules.map((r) => (
            <div key={r.id} className="hook-row">
              <div className="hook-grid">
                <label className="hook-cell">
                  <span className="hook-clabel">Event</span>
                  <select
                    className="skill-input hook-select"
                    value={r.event}
                    onChange={(e) => patch(r.id, { event: e.target.value })}
                  >
                    {HOOK_EVENTS.map((ev) => (
                      <option key={ev} value={ev}>
                        {ev}
                      </option>
                    ))}
                    {!HOOK_EVENTS.includes(r.event) && <option value={r.event}>{r.event}</option>}
                  </select>
                </label>
                <label className="hook-cell">
                  <span className="hook-clabel">
                    Matcher {toolEvent(r.event) ? '' : '(tool events only)'}
                  </span>
                  <input
                    className="skill-input"
                    value={r.matcher}
                    placeholder={toolEvent(r.event) ? 'Bash · Edit|Write · * (blank = all)' : '—'}
                    spellCheck={false}
                    disabled={!toolEvent(r.event)}
                    onChange={(e) => patch(r.id, { matcher: e.target.value })}
                  />
                </label>
              </div>
              <div className="hook-cmd-row">
                <label className="hook-cell hook-cmd-cell">
                  <span className="hook-clabel">Command</span>
                  <input
                    className="skill-input hook-cmd"
                    value={r.command}
                    placeholder='e.g. notify-send "Claude finished"'
                    spellCheck={false}
                    onChange={(e) => patch(r.id, { command: e.target.value })}
                  />
                </label>
                <button className="hook-del" title="Remove hook" onClick={() => removeRule(r.id)}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface McpDraft {
  originalName?: string
  name: string
  transport: McpTransport
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
}

function entryToDraft(e: McpServerEntry): McpDraft {
  return {
    originalName: e.name,
    name: e.name,
    transport: e.transport,
    command: e.command ?? '',
    argsText: (e.args ?? []).join('\n'),
    envText: Object.entries(e.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
    url: e.url ?? '',
    headersText: Object.entries(e.headers ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
  }
}

/** MCP server manager — add/edit/remove servers + live connection status. */
function McpPanel({
  status,
  onChanged
}: {
  status: McpServer[]
  onChanged?: () => void
}): JSX.Element {
  const [servers, setServers] = useState<McpServerEntry[] | null>(null)
  const [editing, setEditing] = useState<McpDraft | null>(null)
  const [busy, setBusy] = useState(false)

  function refresh(): void {
    window.forge.mcp
      .list()
      .then(setServers)
      .catch(() => setServers([]))
  }
  useEffect(refresh, [])

  const statusByName = new Map(status.map((s) => [s.name, s.status]))

  async function remove(name: string): Promise<void> {
    if (!window.confirm(`Remove MCP server "${name}"?`)) return
    setBusy(true)
    try {
      setServers(await window.forge.mcp.delete(name))
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="skills-panel">
      <div className="skills-head">
        <div>
          <div className="skills-title">MCP SERVERS</div>
          <div className="skills-sub">
            Model Context Protocol servers Forge connects on each run · stdio / http / sse
          </div>
        </div>
        <div className="hooks-head-actions">
          <button className="skill-act" onClick={() => onChanged?.()} title="Re-probe connections">
            Test connections
          </button>
          <button
            className="primary skills-new"
            onClick={() =>
              setEditing({
                name: '',
                transport: 'stdio',
                command: '',
                argsText: '',
                envText: '',
                url: '',
                headersText: ''
              })
            }
          >
            + Add server
          </button>
        </div>
      </div>

      {servers === null ? (
        <div className="skills-empty">loading…</div>
      ) : servers.length === 0 ? (
        <div className="skills-empty">
          <div className="skills-empty-icon">🔌</div>
          <div className="skills-empty-title">No MCP servers</div>
          <div className="skills-empty-desc">
            Add a server to give the agent extra tools — a local stdio process or a remote http/sse
            endpoint.
          </div>
        </div>
      ) : (
        <div className="skill-list">
          {servers.map((s) => {
            const st = statusByName.get(s.name)
            return (
              <div key={s.name} className="skill-row">
                <span
                  className={`mcp-dot ${st ? mcpStatusClass(st) : ''}`}
                  title={st ?? 'not yet probed'}
                />
                <button className="skill-main" onClick={() => setEditing(entryToDraft(s))}>
                  <div className="skill-name">
                    {s.name}
                    <span className="mcp-transport">{s.transport}</span>
                    {st ? <span className="mcp-status-inline">{st}</span> : null}
                  </div>
                  <div className="skill-desc">
                    {s.transport === 'stdio'
                      ? [s.command, ...(s.args ?? [])].filter(Boolean).join(' ') || 'No command'
                      : s.url || 'No URL'}
                  </div>
                </button>
                <div className="skill-actions">
                  <button className="skill-act" onClick={() => setEditing(entryToDraft(s))}>
                    Edit
                  </button>
                  <button
                    className="skill-act danger"
                    disabled={busy}
                    onClick={() => remove(s.name)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <McpEditor
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={(list) => {
            setServers(list)
            setEditing(null)
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}

function parseLines(text: string, sep: RegExp): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const m = t.match(sep)
    if (m) out[m[1].trim()] = m[2].trim()
  }
  return out
}

function McpEditor({
  draft,
  onClose,
  onSaved
}: {
  draft: McpDraft
  onClose: () => void
  onSaved: (servers: McpServerEntry[]) => void
}): JSX.Element {
  const isNew = !draft.originalName
  const [name, setName] = useState(draft.name)
  const [transport, setTransport] = useState<McpTransport>(draft.transport)
  const [command, setCommand] = useState(draft.command)
  const [argsText, setArgsText] = useState(draft.argsText)
  const [envText, setEnvText] = useState(draft.envText)
  const [url, setUrl] = useState(draft.url)
  const [headersText, setHeadersText] = useState(draft.headersText)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const nameOk = /^[A-Za-z0-9_-]{1,64}$/.test(name.trim())
  const stdio = transport === 'stdio'
  const canSave =
    nameOk && (stdio ? command.trim().length > 0 : /^https?:\/\//i.test(url.trim()))

  async function save(): Promise<void> {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await window.forge.mcp.save({
        originalName: draft.originalName,
        name: name.trim(),
        transport,
        command: command.trim(),
        args: argsText.split(/\r?\n/).map((a) => a.trim()).filter(Boolean),
        env: parseLines(envText, /^([^=]+)=(.*)$/),
        url: url.trim(),
        headers: parseLines(headersText, /^([^:]+):(.*)$/)
      })
      if (res.ok) onSaved(res.servers)
      else setError(res.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal skill-editor" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{isNew ? 'ADD MCP SERVER' : `EDIT · ${draft.originalName}`}</div>

        <div className="hook-grid">
          <label className="skill-field" style={{ marginBottom: 0 }}>
            <span className="skill-flabel">Name</span>
            <input
              className={`skill-input ${name && !nameOk ? 'bad' : ''}`}
              value={name}
              placeholder="my-server"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              autoFocus={isNew}
            />
          </label>
          <label className="skill-field" style={{ marginBottom: 0 }}>
            <span className="skill-flabel">Transport</span>
            <select
              className="skill-input hook-select"
              value={transport}
              onChange={(e) => setTransport(e.target.value as McpTransport)}
            >
              <option value="stdio">stdio (local process)</option>
              <option value="http">http (remote)</option>
              <option value="sse">sse (remote)</option>
            </select>
          </label>
        </div>

        {stdio ? (
          <>
            <label className="skill-field">
              <span className="skill-flabel">
                Command <span className="skill-hint">executable to spawn</span>
              </span>
              <input
                className="skill-input"
                value={command}
                placeholder="npx"
                spellCheck={false}
                onChange={(e) => setCommand(e.target.value)}
              />
            </label>
            <label className="skill-field">
              <span className="skill-flabel">
                Args <span className="skill-hint">one per line</span>
              </span>
              <textarea
                className="skill-body"
                style={{ minHeight: 80 }}
                value={argsText}
                rows={3}
                spellCheck={false}
                placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path'}
                onChange={(e) => setArgsText(e.target.value)}
              />
            </label>
            <label className="skill-field">
              <span className="skill-flabel">
                Env <span className="skill-hint">KEY=value per line · optional</span>
              </span>
              <textarea
                className="skill-body"
                style={{ minHeight: 64 }}
                value={envText}
                rows={2}
                spellCheck={false}
                placeholder={'API_KEY=...'}
                onChange={(e) => setEnvText(e.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label className="skill-field">
              <span className="skill-flabel">URL</span>
              <input
                className={`skill-input ${url && !/^https?:\/\//i.test(url) ? 'bad' : ''}`}
                value={url}
                placeholder="https://example.com/mcp"
                spellCheck={false}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label className="skill-field">
              <span className="skill-flabel">
                Headers <span className="skill-hint">Key: Value per line · optional</span>
              </span>
              <textarea
                className="skill-body"
                style={{ minHeight: 80 }}
                value={headersText}
                rows={3}
                spellCheck={false}
                placeholder={'Authorization: Bearer ...'}
                onChange={(e) => setHeadersText(e.target.value)}
              />
            </label>
          </>
        )}

        {error && <div className="skill-error">{error}</div>}
        <div className="skill-note">
          Stored in Forge config (not in <code>.claude/</code>) and connected via the SDK on each
          run. Status appears after the next run or “Test connections”.
        </div>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!canSave || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save server'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface AgentDraft {
  originalName?: string
  name: string
  description: string
  tools: string
  model: string
  body: string
}

const AGENT_TEMPLATE = `You are a focused subagent. State your role and how you work.

- Be precise and return only what the caller needs.
`

/** Reusable subagent manager — `.claude/agents/<name>.md`. */
function AgentsPanel(): JSX.Element {
  const [agents, setAgents] = useState<AgentMeta[] | null>(null)
  const [editing, setEditing] = useState<AgentDraft | null>(null)
  const [busy, setBusy] = useState(false)

  function refresh(): void {
    window.forge.agents
      .list()
      .then(setAgents)
      .catch(() => setAgents([]))
  }
  useEffect(refresh, [])

  async function openEdit(name: string): Promise<void> {
    const d = await window.forge.agents.read(name)
    if (d)
      setEditing({
        originalName: d.name,
        name: d.name,
        description: d.description,
        tools: d.tools ?? '',
        model: d.model ?? '',
        body: d.body
      })
  }
  function openNew(): void {
    setEditing({ name: '', description: '', tools: '', model: '', body: AGENT_TEMPLATE })
  }
  async function remove(a: AgentMeta): Promise<void> {
    if (!window.confirm(`Delete agent "${a.name}"? This removes its file.`)) return
    setBusy(true)
    try {
      setAgents(await window.forge.agents.delete(a.name))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="skills-panel">
      <div className="skills-head">
        <div>
          <div className="skills-title">SUBAGENTS</div>
          <div className="skills-sub">
            Authored in <code>.claude/agents</code> · the model delegates to them via the Task tool
          </div>
        </div>
        <button className="primary skills-new" onClick={openNew}>
          + New agent
        </button>
      </div>

      {agents === null ? (
        <div className="skills-empty">loading…</div>
      ) : agents.length === 0 ? (
        <div className="skills-empty">
          <div className="skills-empty-icon">🤖</div>
          <div className="skills-empty-title">No subagents yet</div>
          <div className="skills-empty-desc">
            Create a named agent with its own system prompt — reusable for delegated subtasks.
          </div>
        </div>
      ) : (
        <div className="skill-list">
          {agents.map((a) => (
            <div key={a.name} className="skill-row">
              <button className="skill-main" onClick={() => openEdit(a.name)}>
                <div className="skill-name">
                  {a.name}
                  {a.model ? <span className="mcp-transport">{a.model}</span> : null}
                </div>
                <div className="skill-desc">{a.description || 'No description'}</div>
              </button>
              <div className="skill-actions">
                <button className="skill-act" onClick={() => openEdit(a.name)}>
                  Edit
                </button>
                <button className="skill-act danger" disabled={busy} onClick={() => remove(a)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <AgentEditor
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={(list) => {
            setAgents(list)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function AgentEditor({
  draft,
  onClose,
  onSaved
}: {
  draft: AgentDraft
  onClose: () => void
  onSaved: (agents: AgentMeta[]) => void
}): JSX.Element {
  const isNew = !draft.originalName
  const [name, setName] = useState(draft.name)
  const [description, setDescription] = useState(draft.description)
  const [tools, setTools] = useState(draft.tools)
  const [model, setModel] = useState(draft.model)
  const [body, setBody] = useState(draft.body)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const nameOk = SKILL_NAME_RE.test(name.trim())

  async function save(): Promise<void> {
    if (!nameOk) return
    setSaving(true)
    setError(null)
    try {
      const res = await window.forge.agents.write({
        name: name.trim(),
        description,
        tools,
        model,
        body,
        originalName: draft.originalName
      })
      if (res.ok) onSaved(res.agents)
      else setError(res.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal skill-editor" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{isNew ? 'NEW SUBAGENT' : `EDIT · ${draft.originalName}`}</div>

        <label className="skill-field">
          <span className="skill-flabel">
            Name <span className="skill-hint">lowercase-hyphen id · the file name</span>
          </span>
          <input
            className={`skill-input ${name && !nameOk ? 'bad' : ''}`}
            value={name}
            placeholder="test-writer"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            autoFocus={isNew}
          />
        </label>

        <label className="skill-field">
          <span className="skill-flabel">
            Description <span className="skill-hint">tells the model when to delegate to it</span>
          </span>
          <input
            className="skill-input"
            value={description}
            placeholder="Writes thorough unit tests for a given module."
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="hook-grid">
          <label className="skill-field" style={{ marginBottom: 0 }}>
            <span className="skill-flabel">
              Tools <span className="skill-hint">optional · comma-sep</span>
            </span>
            <input
              className="skill-input"
              value={tools}
              placeholder="Read, Grep, Bash"
              spellCheck={false}
              onChange={(e) => setTools(e.target.value)}
            />
          </label>
          <label className="skill-field" style={{ marginBottom: 0 }}>
            <span className="skill-flabel">
              Model <span className="skill-hint">optional</span>
            </span>
            <input
              className="skill-input"
              value={model}
              placeholder="sonnet · opus · inherit"
              spellCheck={false}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
        </div>

        <label className="skill-field">
          <span className="skill-flabel">
            System prompt <span className="skill-hint">the agent's instructions</span>
          </span>
          <textarea
            className="skill-body"
            value={body}
            rows={9}
            spellCheck={false}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>

        {error && <div className="skill-error">{error}</div>}
        <div className="skill-note">
          Saved to <code>.claude/agents/{name.trim() || 'name'}.md</code>. Discovered by the engine
          and usable via the Task tool.
        </div>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!nameOk || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save agent'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Local plugin bundles passed to the SDK `plugins` option. */
function PluginsPanel({ onChanged }: { onChanged?: () => void }): JSX.Element {
  const [plugins, setPlugins] = useState<PluginEntry[] | null>(null)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function refresh(): void {
    window.forge.plugins
      .list()
      .then(setPlugins)
      .catch(() => setPlugins([]))
  }
  useEffect(refresh, [])

  async function add(): Promise<void> {
    const p = path.trim()
    if (!p) return
    setBusy(true)
    setError(null)
    try {
      const res = await window.forge.plugins.add(p)
      if (res.ok) {
        setPlugins(res.plugins)
        setPath('')
        onChanged?.()
      } else setError(res.error)
    } finally {
      setBusy(false)
    }
  }
  async function toggle(p: PluginEntry): Promise<void> {
    setBusy(true)
    try {
      setPlugins(await window.forge.plugins.toggle(p.path, !p.enabled))
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }
  async function remove(p: PluginEntry): Promise<void> {
    if (!window.confirm(`Unregister plugin?\n${p.path}`)) return
    setBusy(true)
    try {
      setPlugins(await window.forge.plugins.remove(p.path))
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="skills-panel">
      <div className="skills-head">
        <div>
          <div className="skills-title">PLUGINS</div>
          <div className="skills-sub">
            Local plugin bundles (a dir with <code>.claude-plugin/plugin.json</code>) — skills,
            commands, hooks &amp; agents in one package
          </div>
        </div>
      </div>

      <div className="plugin-add">
        <input
          className={`skill-input ${error ? 'bad' : ''}`}
          value={path}
          placeholder="C:\path\to\plugin-dir"
          spellCheck={false}
          onChange={(e) => {
            setPath(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <button className="primary skills-new" disabled={!path.trim() || busy} onClick={add}>
          + Add
        </button>
      </div>
      {error && <div className="skill-error" style={{ marginBottom: 12 }}>{error}</div>}

      {plugins === null ? (
        <div className="skills-empty">loading…</div>
      ) : plugins.length === 0 ? (
        <div className="skills-empty">
          <div className="skills-empty-icon">📦</div>
          <div className="skills-empty-title">No plugins registered</div>
          <div className="skills-empty-desc">
            Point Forge at a local plugin directory to load its bundled extensions on each run.
          </div>
        </div>
      ) : (
        <div className="skill-list">
          {plugins.map((p) => (
            <div key={p.path} className={`skill-row ${p.enabled ? '' : 'off'}`}>
              <button
                className={`skill-switch ${p.enabled ? 'on' : ''}`}
                title={p.enabled ? 'Enabled' : 'Disabled'}
                disabled={busy}
                onClick={() => toggle(p)}
              >
                <span className="skill-knob" />
              </button>
              <div className="skill-main" style={{ cursor: 'default' }}>
                <div className="skill-name">
                  {p.manifestName || p.path.replace(/^.*[\\/]/, '')}
                  {!p.exists ? (
                    <span className="mcp-status-inline" style={{ color: 'var(--danger)' }}>
                      missing
                    </span>
                  ) : p.error ? (
                    <span className="mcp-status-inline">{p.error}</span>
                  ) : (
                    <span className="mcp-status-inline">ok</span>
                  )}
                </div>
                <div className="skill-desc">{p.path}</div>
              </div>
              <div className="skill-actions">
                <button className="skill-act danger" disabled={busy} onClick={() => remove(p)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface RunMeta {
  costUsd?: number
  durationMs?: number
  error?: string
}

type Block =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      toolId: string
      name: string
      inputRaw: string
      status: 'running' | 'ok' | 'error'
      result?: string
    }

function toolIcon(name: string): string {
  switch (name) {
    case 'Bash':
      return '$_'
    case 'Read':
      return '≡'
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return '✎'
    case 'Glob':
    case 'Grep':
      return '⌕'
    case 'Task':
      return '◆'
    case 'Skill':
      return '🧩'
    case 'WebFetch':
    case 'WebSearch':
      return '∮'
    default:
      return '⛏'
  }
}

function toolArgObj(input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>
  return String(
    o.skill ??
      o.command ??
      o.file_path ??
      o.path ??
      o.pattern ??
      o.url ??
      o.description ??
      o.subject ??
      o.status ??
      o.query ??
      o.name ??
      ''
  )
}

function toolArg(inputRaw: string): string {
  try {
    return toolArgObj(JSON.parse(inputRaw))
  } catch {
    return ''
  }
}

interface Todo {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

/** Tolerant parse of a TodoWrite tool input (may be partial mid-stream). */
function parseTodos(input: unknown): Todo[] | null {
  try {
    const o = typeof input === 'string' ? JSON.parse(input) : input
    const todos = (o as { todos?: unknown })?.todos
    if (Array.isArray(todos)) {
      return todos
        .filter((t): t is Todo => !!t && typeof (t as Todo).content === 'string')
        .map((t) => ({
          content: t.content,
          status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending',
          activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined
        }))
    }
  } catch {
    /* partial JSON while streaming */
  }
  return null
}

/** Render a TodoWrite list as a live checklist (shared by live + history views). */
function TodoList({ todos }: { todos: Todo[] }): JSX.Element {
  const done = todos.filter((t) => t.status === 'completed').length
  return (
    <div className="todo-card">
      <div className="todo-head">
        <span className="tool-icon">☑</span>
        <span className="tool-name">TASKS</span>
        <span className="todo-count">
          {done}/{todos.length}
        </span>
      </div>
      <ul className="todo-list">
        {todos.map((t, i) => (
          <li key={i} className={`todo-item ${t.status}`}>
            <span className="todo-check">
              {t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'}
            </span>
            <span className="todo-text">
              {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Render a restored past-conversation transcript (read-only). */
function HistoryView({ items }: { items: TranscriptItem[] }): JSX.Element | null {
  if (!items.length) return null
  return (
    <div className="history">
      {items.map((it, i) => {
        if (it.kind === 'user') {
          return (
            <div key={i} className="user-msg">
              {it.text}
            </div>
          )
        }
        if (it.kind === 'text') {
          return (
            <div key={i} className="response">
              <Md>{it.text}</Md>
            </div>
          )
        }
        if (it.kind === 'thinking') {
          return (
            <div key={i} className="thinking">
              <div className="thinking-head">THINKING</div>
              <pre className="thinking-text">{it.text}</pre>
            </div>
          )
        }
        if (it.name === 'TodoWrite') {
          const todos = parseTodos(it.input)
          if (todos && todos.length) return <TodoList key={i} todos={todos} />
        }
        const arg = toolArgObj(it.input)
        const badge = it.status === 'error' ? 'ERR' : 'OK'
        const result =
          it.result && it.result.length > 700 ? it.result.slice(0, 700) + '…' : it.result
        return (
          <div key={i} className={`tool-card ${it.status}`}>
            <div className="tool-row">
              <span className="tool-icon">{toolIcon(it.name)}</span>
              <span className="tool-name">{it.name}</span>
              <span className="tool-arg">{arg}</span>
              <span className={`tool-badge ${it.status}`}>{badge}</span>
            </div>
            {result && <pre className="tool-result">{result}</pre>}
          </div>
        )
      })}
      <div className="history-divider">— resumed · continue below —</div>
    </div>
  )
}

/** Pinned, collapsible task progress bar (shown above the composer). */
function TodoBar({ todos }: { todos: Todo[] }): JSX.Element {
  const [open, setOpen] = useState(true)
  const done = todos.filter((t) => t.status === 'completed').length
  const current = todos.find((t) => t.status === 'in_progress')
  const pct = todos.length ? Math.round((done / todos.length) * 100) : 0
  return (
    <div className="todo-bar">
      <button className="todo-bar-head" onClick={() => setOpen((o) => !o)}>
        <span className="todo-bar-caret">{open ? '▾' : '▸'}</span>
        <span className="todo-bar-title">TASKS</span>
        <span className="todo-bar-prog">
          {done}/{todos.length}
        </span>
        {!open && current && (
          <span className="todo-bar-current">{current.activeForm || current.content}</span>
        )}
        <span className="todo-bar-track">
          <span className="todo-bar-fill" style={{ width: `${pct}%` }} />
        </span>
      </button>
      {open && (
        <ul className="todo-list">
          {todos.map((t, i) => (
            <li key={i} className={`todo-item ${t.status}`}>
              <span className="todo-check">
                {t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'}
              </span>
              <span className="todo-text">
                {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BlockView({ block, streaming }: { block: Block; streaming: boolean }): JSX.Element | null {
  if (block.kind === 'text') {
    if (!block.text && !streaming) return null
    return (
      <div className="response">
        <Md>{block.text}</Md>
        {streaming && <span className="caret">▍</span>}
      </div>
    )
  }
  if (block.kind === 'thinking') {
    if (!block.text && !streaming) return null
    return (
      <div className="thinking">
        <div className="thinking-head">THINKING</div>
        <pre className="thinking-text">
          {block.text}
          {streaming && <span className="caret">▍</span>}
        </pre>
      </div>
    )
  }
  // TodoWrite renders as a checklist rather than a generic tool card.
  if (block.name === 'TodoWrite') {
    const todos = parseTodos(block.inputRaw)
    if (todos && todos.length) return <TodoList todos={todos} />
    return (
      <div className="todo-card">
        <div className="todo-head">
          <span className="tool-icon">☑</span>
          <span className="tool-name">TASKS</span>
        </div>
        <div className="muted small">updating…</div>
      </div>
    )
  }
  const arg = toolArg(block.inputRaw)
  const badge = block.status === 'ok' ? 'OK' : block.status === 'error' ? 'ERR' : 'RUNNING'
  const result =
    block.result && block.result.length > 700 ? block.result.slice(0, 700) + '…' : block.result
  return (
    <div className={`tool-card ${block.status}`}>
      <div className="tool-row">
        <span className="tool-icon">{toolIcon(block.name)}</span>
        <span className="tool-name">{block.name}</span>
        <span className="tool-arg">{arg}</span>
        <span className={`tool-badge ${block.status}`}>{badge}</span>
      </div>
      {result && block.status !== 'running' && <pre className="tool-result">{result}</pre>}
    </div>
  )
}

interface Turn {
  id: string
  prompt: string
  previews: string[]
  blocks: Block[]
  meta: RunMeta | null
  running: boolean
}

function normTaskStatus(s: string): Todo['status'] {
  return s === 'completed' ? 'completed' : s === 'in_progress' ? 'in_progress' : 'pending'
}

/**
 * Reconstruct the current task list from Task-tool activity across the live
 * transcript. The SDK's models manage work via TaskCreate/TaskUpdate/TaskList
 * (not TodoWrite), so we replay those calls:
 *  - TaskCreate result "Task #<id> created successfully: <subject>" → add task
 *  - TaskUpdate input { taskId, status, subject? }                 → mutate task
 *  - TaskList result "#<id> [<status>] <subject>" (per line)       → snapshot sync
 */
function deriveTasks(turns: Turn[]): Todo[] {
  type T = Todo & { id: string }
  const map = new Map<string, T>()
  const order: string[] = []
  const upsert = (id: string, patch: Partial<T>): void => {
    const cur = map.get(id)
    if (!cur) {
      order.push(id)
      map.set(id, {
        id,
        content: patch.content ?? `Task ${id}`,
        status: patch.status ?? 'pending',
        activeForm: patch.activeForm
      })
    } else {
      map.set(id, { ...cur, ...patch })
    }
  }
  for (const turn of turns) {
    for (const b of turn.blocks) {
      if (b.kind !== 'tool') continue
      if (b.name === 'TaskCreate') {
        const m = /Task #(\d+) created successfully:\s*([\s\S]+)/.exec(b.result ?? '')
        if (m) {
          let activeForm: string | undefined
          try {
            activeForm = (JSON.parse(b.inputRaw) as { activeForm?: string }).activeForm
          } catch {
            /* still streaming */
          }
          upsert(m[1], { content: m[2].trim(), activeForm })
        }
      } else if (b.name === 'TaskUpdate') {
        try {
          const inp = JSON.parse(b.inputRaw) as {
            taskId?: string | number
            status?: string
            subject?: string
            activeForm?: string
          }
          if (inp.taskId != null) {
            const id = String(inp.taskId)
            if (inp.status === 'deleted') {
              map.delete(id)
              const i = order.indexOf(id)
              if (i >= 0) order.splice(i, 1)
            } else {
              upsert(id, {
                ...(inp.status ? { status: normTaskStatus(inp.status) } : {}),
                ...(inp.subject ? { content: inp.subject } : {}),
                ...(inp.activeForm ? { activeForm: inp.activeForm } : {})
              })
            }
          }
        } catch {
          /* partial JSON mid-stream */
        }
      } else if (b.name === 'TaskList') {
        for (const line of (b.result ?? '').split('\n')) {
          const m = /^#(\d+)\s+\[([a-z_]+)\]\s+([\s\S]+)$/.exec(line.trim())
          if (m) upsert(m[1], { content: m[3].trim(), status: normTaskStatus(m[2]) })
        }
      }
    }
  }
  return order
    .map((id) => map.get(id))
    .filter((t): t is T => !!t)
    .map(({ content, status, activeForm }) => ({ content, status, activeForm }))
}

/** Apply one streaming event to a turn's ordered block list. */
function reduceBlocks(blocks: Block[], ev: AgentEvent): Block[] {
  if (ev.type === 'block-start') {
    if (blocks.some((b) => b.id === ev.blockId)) return blocks
    if (ev.kind === 'tool') {
      const t: Block = {
        kind: 'tool',
        id: ev.blockId,
        toolId: ev.toolId ?? ev.blockId,
        name: ev.name ?? 'tool',
        inputRaw: '',
        status: 'running'
      }
      return [...blocks, t]
    }
    const t: Block = { kind: ev.kind, id: ev.blockId, text: '' }
    return [...blocks, t]
  }
  if (ev.type === 'block-delta') {
    return blocks.map((b) =>
      b.id === ev.blockId && (b.kind === 'text' || b.kind === 'thinking')
        ? { ...b, text: b.text + ev.text }
        : b
    )
  }
  if (ev.type === 'tool-input') {
    return blocks.map((b) =>
      b.id === ev.blockId && b.kind === 'tool' ? { ...b, inputRaw: b.inputRaw + ev.partialJson } : b
    )
  }
  if (ev.type === 'tool-result') {
    return blocks.map((b) =>
      b.kind === 'tool' && b.toolId === ev.toolId
        ? { ...b, status: ev.ok ? 'ok' : 'error', result: ev.content }
        : b
    )
  }
  return blocks
}

/** One user→assistant exchange in the live transcript. */
function TurnView({
  turn,
  onRetry,
  onEdit
}: {
  turn: Turn
  onRetry: () => void
  onEdit: () => void
}): JSX.Element {
  const lastIdx = turn.blocks.length - 1
  function copy(): void {
    const text = turn.blocks
      .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n\n')
    if (text) navigator.clipboard?.writeText(text)
  }
  return (
    <div className="turn">
      <div className="user-msg">
        {turn.previews.length > 0 && (
          <div className="user-imgs">
            {turn.previews.map((p, i) => (
              <img key={i} src={p} alt="" />
            ))}
          </div>
        )}
        {turn.prompt}
      </div>
      {turn.blocks.map((b, i) => (
        <BlockView key={b.id} block={b} streaming={turn.running && i === lastIdx} />
      ))}
      {turn.running && turn.blocks.length === 0 && <div className="muted small">forging…</div>}
      {turn.meta?.error && (
        <div className="response response-error">
          <pre className="response-text">⚠ {turn.meta.error}</pre>
        </div>
      )}
      {turn.meta && !turn.meta.error && !turn.running && (
        <div className="response-footer">
          <div className="response-meta standalone">
            {typeof turn.meta.costUsd === 'number' && <span>${turn.meta.costUsd.toFixed(4)}</span>}
            {typeof turn.meta.durationMs === 'number' && (
              <span>{(turn.meta.durationMs / 1000).toFixed(1)}s</span>
            )}
          </div>
          <div className="msg-actions">
            <button className="msg-act" onClick={copy} title="Copy response">
              ⧉ copy
            </button>
            <button className="msg-act" onClick={onRetry} title="Retry same prompt">
              ↻ retry
            </button>
            <button className="msg-act" onClick={onEdit} title="Edit & resend">
              ✎ edit
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface PermReq {
  id: string
  toolName: string
  input: Record<string, unknown>
}

function permArg(input: Record<string, unknown>): string {
  const o = input as Record<string, unknown>
  return String(o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? '')
}

function PermissionModal({
  req,
  onResolve
}: {
  req: PermReq
  onResolve: (allow: boolean) => void
}): JSX.Element {
  const arg = permArg(req.input)
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-title">PERMISSION REQUESTED</div>
        <div className="modal-tool">
          <span className="tool-icon">{toolIcon(req.toolName)}</span>
          <strong>{req.toolName}</strong>
        </div>
        {arg && <pre className="modal-arg">{arg}</pre>}
        <div className="modal-actions">
          <button className="ghost" onClick={() => onResolve(false)}>
            Deny
          </button>
          <button className="primary" autoFocus onClick={() => onResolve(true)}>
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}

interface DialogReq {
  id: string
  dialogKind: string
  payload: Record<string, unknown>
  toolUseID?: string
}

/** Answer to an AskUserQuestion prompt (matches the main-process QuestionResult). */
type QResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

interface DialogOption {
  label: string
  description?: string
  preview?: string
}
interface DialogQuestion {
  question: string
  header?: string
  multiSelect?: boolean
  options: DialogOption[]
}

/**
 * Interactive UI for the AskUserQuestion tool (dialogKind
 * 'permission_ask_user_question'). On submit we return the PermissionResult the
 * CLI expects: { behavior:'allow', updatedInput:{ questions, answers, annotations } }
 * where answers maps each question string to the chosen label(s).
 */
function QuestionModal({
  req,
  onSubmit,
  onCancel
}: {
  req: DialogReq
  onSubmit: (result: QResult) => void
  onCancel: () => void
}): JSX.Element {
  const questions = (Array.isArray(req.payload.questions)
    ? req.payload.questions
    : []) as DialogQuestion[]
  const [picks, setPicks] = useState<Record<string, string[]>>({})
  const [others, setOthers] = useState<Record<string, string>>({})

  function toggle(q: DialogQuestion, label: string): void {
    setPicks((prev) => {
      const cur = prev[q.question] ?? []
      if (q.multiSelect) {
        return {
          ...prev,
          [q.question]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]
        }
      }
      return { ...prev, [q.question]: cur.includes(label) ? [] : [label] }
    })
  }

  const answered = questions.every(
    (q) => (picks[q.question]?.length ?? 0) > 0 || (others[q.question] ?? '').trim().length > 0
  )

  function submit(): void {
    const answers: Record<string, string> = {}
    const annotations: Record<string, { preview?: string; notes?: string }> = {}
    for (const q of questions) {
      const chosen = [...(picks[q.question] ?? [])]
      const other = (others[q.question] ?? '').trim()
      if (other) chosen.push(other)
      if (!chosen.length) continue
      answers[q.question] = chosen.join(', ')
      const ann: { preview?: string; notes?: string } = {}
      if (!q.multiSelect && picks[q.question]?.length === 1) {
        const opt = q.options.find((o) => o.label === picks[q.question][0])
        if (opt?.preview) ann.preview = opt.preview
      }
      if (other) ann.notes = other
      if (ann.preview || ann.notes) annotations[q.question] = ann
    }
    onSubmit({ behavior: 'allow', updatedInput: { questions, answers, annotations } })
  }

  return (
    <div className="modal-overlay">
      <div className="modal question-modal">
        <div className="modal-title">CLAUDE ASKS</div>
        {questions.map((q, qi) => {
          const chosen = picks[q.question] ?? []
          return (
            <div className="q-block" key={qi}>
              <div className="q-head">
                {q.header && <span className="q-header">{q.header}</span>}
                {q.multiSelect && <span className="q-multi">multi-select</span>}
              </div>
              <div className="q-text">{q.question}</div>
              <div className="q-options">
                {q.options.map((o, oi) => (
                  <button
                    key={oi}
                    className={`q-option${chosen.includes(o.label) ? ' selected' : ''}`}
                    onClick={() => toggle(q, o.label)}
                  >
                    <span className="q-opt-label">{o.label}</span>
                    {o.description && <span className="q-opt-desc">{o.description}</span>}
                  </button>
                ))}
              </div>
              <input
                className="q-other"
                placeholder="Other… (type a custom answer)"
                value={others[q.question] ?? ''}
                onChange={(e) => setOthers((p) => ({ ...p, [q.question]: e.target.value }))}
              />
            </div>
          )
        })}
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" disabled={!answered} onClick={submit}>
            Submit
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Context window for a model id or alias. Most current models ship a 1M window
 * natively (Sonnet 4.5/4.6, Opus 4.5+, Fable/Mythos) — only Haiku and the older
 * Opus 4.0/4.1 are 200k. The `[1m]` suffix (subscription 1M tier) is always 1M.
 * Unknown ids default to 200k (the safe, conservative side for compaction).
 */
function ctxWindow(model: string): number {
  if (!model) return 1_000_000
  const m = model.toLowerCase()
  if (m.includes('[1m]')) return 1_000_000
  if (m.includes('haiku')) return 200_000
  if (m.includes('fable') || m.includes('mythos')) return 1_000_000
  if (m.includes('sonnet')) {
    // Sonnet 4.5 / 4.6 (and the bare `sonnet` alias) are 1M; older Sonnets 200k.
    return m === 'sonnet' || m.includes('sonnet-4-5') || m.includes('sonnet-4-6')
      ? 1_000_000
      : 200_000
  }
  if (m.includes('opus')) {
    // Opus 4.5/4.6/4.7/4.8 (and bare `opus`) are 1M; Opus 4.0/4.1 are 200k.
    return m.includes('opus-4-0') || m.includes('opus-4-1') ? 200_000 : 1_000_000
  }
  return 200_000
}

const CLIENT_COMMANDS: SlashCommand[] = [
  {
    name: 'model',
    description: 'Set the model — alias or any id, e.g. /model claude-opus-4-6',
    argumentHint: '<name|id>'
  },
  { name: 'effort', description: 'Set reasoning effort', argumentHint: '<auto|low|medium|high|xhigh|max>' },
  { name: 'permission', description: 'Set permission mode', argumentHint: '<plan|ask|auto-edit|yolo>' },
  { name: 'clear', description: 'Start a new conversation', aliases: ['new'] },
  { name: 'help', description: 'Show available commands' }
]

// ---- Squad (multi-agent) ----

interface SquadAgent {
  id: string
  name: string
  model: string
  effort: EffortLabel
  permission: Permission
  persona: string
  task: string
  runId: string | null
  status: 'idle' | 'running' | 'done' | 'error'
  contextModel: string
  contextTokens: number
  costUsd: number
  turns: Turn[]
}

function makeAgent(p: Partial<SquadAgent> & { name: string }): SquadAgent {
  return {
    id: crypto.randomUUID(),
    name: p.name,
    model: p.model ?? 'default',
    effort: p.effort ?? 'AUTO',
    permission: p.permission ?? 'plan',
    persona: p.persona ?? '',
    task: p.task ?? '',
    runId: null,
    status: 'idle',
    contextModel: '',
    contextTokens: 0,
    costUsd: 0,
    turns: []
  }
}

function squadPreset(name: string): { agents: SquadAgent[]; broadcast?: string } {
  if (name === 'race') {
    return {
      agents: [
        makeAgent({ name: 'Opus', model: 'opus[1m]' }),
        makeAgent({ name: 'Sonnet', model: 'sonnet' }),
        makeAgent({ name: 'Haiku', model: 'haiku' })
      ]
    }
  }
  if (name === 'review') {
    return {
      broadcast: 'Review the code in this project and report concrete findings with file:line.',
      agents: [
        makeAgent({
          name: 'Correctness',
          model: 'sonnet',
          persona: 'Review strictly for correctness bugs, edge cases and logic errors. List concrete issues with file:line; do not fix.'
        }),
        makeAgent({
          name: 'Security',
          model: 'sonnet',
          persona: 'Review strictly for security: injection, auth, secrets, unsafe input/eval. List concrete risks with file:line; do not fix.'
        }),
        makeAgent({
          name: 'Performance',
          model: 'sonnet',
          persona: 'Review strictly for performance: complexity, allocations, N+1, blocking I/O. Suggest concrete optimizations; do not fix.'
        })
      ]
    }
  }
  if (name === 'research') {
    return {
      agents: [
        makeAgent({ name: 'Angle A', model: 'sonnet' }),
        makeAgent({ name: 'Angle B', model: 'sonnet' }),
        makeAgent({ name: 'Angle C', model: 'sonnet' })
      ]
    }
  }
  return { agents: [makeAgent({ name: 'Agent 1' }), makeAgent({ name: 'Agent 2' })] }
}

function SquadView({
  models,
  defaults,
  maxTurns,
  maxBudget,
  onResult
}: {
  models: ModelInfo[]
  defaults: { model: string; effort: EffortLabel; permission: Permission }
  maxTurns: number
  maxBudget: number
  onResult: (r: {
    costUsd?: number
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    contextTokens?: number
  }) => void
}): JSX.Element {
  const [agents, setAgents] = useState<SquadAgent[]>([])
  const [broadcast, setBroadcast] = useState('')
  const [configOpen, setConfigOpen] = useState(true)
  const [perms, setPerms] = useState<PermReq[]>([])
  const runMapRef = useRef<Record<string, string>>({})
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  // Load persisted config (or seed a default squad).
  useEffect(() => {
    try {
      const raw = localStorage.getItem('forge-squads')
      if (raw) {
        const saved = JSON.parse(raw)
        if (Array.isArray(saved.agents) && saved.agents.length) {
          setAgents(saved.agents.map((a: Partial<SquadAgent> & { name: string }) => makeAgent(a)))
          setBroadcast(typeof saved.broadcast === 'string' ? saved.broadcast : '')
          return
        }
      }
    } catch {
      /* ignore */
    }
    setAgents(squadPreset('race').agents)
  }, [])

  // Persist config only (not runtime turns).
  useEffect(() => {
    const cfg = {
      broadcast,
      agents: agents.map((a) => ({
        name: a.name,
        model: a.model,
        effort: a.effort,
        permission: a.permission,
        persona: a.persona,
        task: a.task
      }))
    }
    try {
      localStorage.setItem('forge-squads', JSON.stringify(cfg))
    } catch {
      /* ignore */
    }
  }, [agents, broadcast])

  // One subscription; fan events out to the matching agent by runId.
  useEffect(() => {
    return window.forge.agent.onEvent((ev) => {
      const agentId = runMapRef.current[ev.runId]
      if (!agentId) return
      if (ev.type === 'session') return
      if (ev.type === 'system') {
        if (ev.model) setAgents((p) => p.map((a) => (a.id === agentId ? { ...a, contextModel: ev.model! } : a)))
        return
      }
      if (ev.type === 'dialog') {
        // Squad is non-interactive (plan/read-only); deny so the run doesn't hang.
        window.forge.agent.respondDialog(ev.id, {
          behavior: 'deny',
          message: 'Squad agents cannot answer interactive questions'
        })
        return
      }
      if (ev.type === 'permission') {
        setPerms((prev) => [...prev, { id: ev.id, toolName: ev.toolName, input: ev.input }])
        return
      }
      if (ev.type === 'result') {
        setAgents((p) =>
          p.map((a) =>
            a.id === agentId
              ? {
                  ...a,
                  status: ev.error ? 'error' : 'done',
                  costUsd: a.costUsd + (ev.costUsd ?? 0),
                  contextTokens: ev.contextTokens ?? a.contextTokens,
                  turns: a.turns.map((t, i) =>
                    i === a.turns.length - 1
                      ? { ...t, running: false, meta: { costUsd: ev.costUsd, durationMs: ev.durationMs, error: ev.error } }
                      : t
                  )
                }
              : a
          )
        )
        if (ev.ok) {
          onResultRef.current({
            costUsd: ev.costUsd,
            inputTokens: ev.inputTokens,
            outputTokens: ev.outputTokens,
            cacheReadTokens: ev.cacheReadTokens,
            contextTokens: ev.contextTokens
          })
        }
        return
      }
      setAgents((p) =>
        p.map((a) =>
          a.id === agentId
            ? {
                ...a,
                turns: a.turns.map((t, i) =>
                  i === a.turns.length - 1 ? { ...t, blocks: reduceBlocks(t.blocks, ev) } : t
                )
              }
            : a
        )
      )
    })
  }, [])

  function updateAgent(id: string, patch: Partial<SquadAgent>): void {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }
  function addAgent(): void {
    setAgents((prev) =>
      prev.length >= 6
        ? prev
        : [
            ...prev,
            makeAgent({
              name: `Agent ${prev.length + 1}`,
              model: defaults.model,
              effort: defaults.effort,
              permission: defaults.permission
            })
          ]
    )
  }
  function removeAgent(id: string): void {
    setAgents((prev) => prev.filter((a) => a.id !== id))
  }
  function loadPreset(name: string): void {
    const p = squadPreset(name)
    setAgents(p.agents)
    if (p.broadcast !== undefined) setBroadcast(p.broadcast)
  }

  function runAgent(a: SquadAgent): void {
    if (a.status === 'running') return
    const task = (a.task || broadcast).trim()
    if (!task) return
    const runId = crypto.randomUUID()
    runMapRef.current[runId] = a.id
    setAgents((prev) =>
      prev.map((x) =>
        x.id === a.id
          ? {
              ...x,
              runId,
              status: 'running',
              costUsd: 0,
              contextTokens: 0,
              turns: [{ id: runId, prompt: task, previews: [], blocks: [], meta: null, running: true }]
            }
          : x
      )
    )
    const opts: import('../../main/agent').RunOptions = { permission: a.permission }
    const eff = effortOption(a.effort)
    if (eff) opts.effort = eff
    if (a.model && a.model !== 'default') opts.model = a.model
    if (a.persona.trim()) {
      opts.systemPrompt = { type: 'preset', preset: 'claude_code', append: a.persona.trim() }
    }
    if (maxTurns > 0) opts.maxTurns = maxTurns
    if (maxBudget > 0) opts.maxBudgetUsd = maxBudget
    window.forge.agent.start(runId, task, opts).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      setAgents((prev) =>
        prev.map((x) =>
          x.id === a.id
            ? {
                ...x,
                status: 'error',
                turns: x.turns.map((t, i) =>
                  i === x.turns.length - 1 ? { ...t, running: false, meta: { error: msg } } : t
                )
              }
            : x
        )
      )
    })
  }
  function runAll(): void {
    agents.forEach((a) => runAgent(a))
  }
  function stopAgent(a: SquadAgent): void {
    if (a.runId) window.forge.agent.interrupt(a.runId)
  }
  function stopAll(): void {
    agents.forEach(stopAgent)
  }

  const runningCount = agents.filter((a) => a.status === 'running').length
  const doneCount = agents.filter((a) => a.status === 'done' || a.status === 'error').length
  const totalCost = agents.reduce((s, a) => s + a.costUsd, 0)
  const hasEditPerm = agents.some((a) => a.permission === 'acceptEdits' || a.permission === 'bypassPermissions')

  return (
    <div className="squad">
      <div className="squad-bar">
        <textarea
          className="squad-broadcast"
          placeholder="Broadcast task to all agents (a per-agent task overrides this)…"
          rows={2}
          value={broadcast}
          onChange={(e) => setBroadcast(e.target.value)}
        />
        {runningCount > 0 ? (
          <button className="stop squad-run" onClick={stopAll}>
            ■ STOP ALL
          </button>
        ) : (
          <button className="primary squad-run" onClick={runAll} disabled={agents.length === 0}>
            ▶ RUN ALL · {agents.length}
          </button>
        )}
      </div>

      <div className="squad-controls">
        <button className="mini-btn" onClick={() => setConfigOpen((v) => !v)}>
          {configOpen ? '▾' : '▸'} configure
        </button>
        <div className="squad-presets">
          <button className="persona-chip" onClick={() => loadPreset('race')}>
            + model race
          </button>
          <button className="persona-chip" onClick={() => loadPreset('review')}>
            + review panel
          </button>
          <button className="persona-chip" onClick={() => loadPreset('research')}>
            + research
          </button>
        </div>
        <div className="squad-cost">
          {totalCost > 0 ? `$${totalCost.toFixed(4)} · ` : ''}
          {doneCount}/{agents.length} done
        </div>
      </div>

      {configOpen && (
        <div className="squad-config">
          {agents.map((a) => (
            <div className="agent-row" key={a.id}>
              <input
                className="ar-name"
                value={a.name}
                onChange={(e) => updateAgent(a.id, { name: e.target.value })}
              />
              <select value={a.model} onChange={(e) => updateAgent(a.id, { model: e.target.value })}>
                {models.length === 0 && <option value={a.model}>{a.model}</option>}
                {models.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <select
                value={a.effort}
                onChange={(e) => updateAgent(a.id, { effort: e.target.value as EffortLabel })}
              >
                {EFFORTS.map((e2) => (
                  <option key={e2} value={e2}>
                    {e2}
                  </option>
                ))}
              </select>
              <select
                value={a.permission}
                onChange={(e) => updateAgent(a.id, { permission: e.target.value as Permission })}
              >
                {PERMS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <input
                className="ar-task"
                placeholder="task (optional, overrides broadcast)"
                value={a.task}
                onChange={(e) => updateAgent(a.id, { task: e.target.value })}
              />
              <input
                className="ar-persona"
                placeholder="persona (optional)"
                value={a.persona}
                onChange={(e) => updateAgent(a.id, { persona: e.target.value })}
              />
              <button className="ar-x" title="Remove" onClick={() => removeAgent(a.id)}>
                ✕
              </button>
            </div>
          ))}
          <div className="agent-row-foot">
            <button className="mini-btn" onClick={addAgent} disabled={agents.length >= 6}>
              + add agent
            </button>
            {hasEditPerm && (
              <span className="agent-warn">
                ⚠ edit-permission agents share this folder — concurrent edits can collide. PLAN is
                safest for parallel runs.
              </span>
            )}
          </div>
        </div>
      )}

      <div className="squad-grid">
        {agents.map((a) => (
          <div className="agent-panel" key={a.id}>
            <div className="agent-panel-head">
              <span className={`agent-status ${a.status}`} />
              <span className="agent-name">{a.name}</span>
              <span className="agent-tag">
                {a.model} · {a.effort.toLowerCase()} · {a.permission}
              </span>
              <span className="agent-spacer" />
              {a.contextTokens > 0 && (
                <span className="agent-ctx">
                  ctx{' '}
                  {Math.min(
                    100,
                    Math.round((a.contextTokens / ctxWindow(a.contextModel || a.model)) * 100)
                  )}
                  %
                </span>
              )}
              {a.costUsd > 0 && <span className="agent-cost">${a.costUsd.toFixed(4)}</span>}
              {a.status === 'running' ? (
                <button className="mini-btn" onClick={() => stopAgent(a)}>
                  stop
                </button>
              ) : (
                <button className="mini-btn" onClick={() => runAgent(a)}>
                  run
                </button>
              )}
            </div>
            <div className="agent-transcript">
              {a.turns.length === 0 ? (
                <div className="agent-idle">idle — Run to start</div>
              ) : (
                a.turns.map((t) => (
                  <TurnView key={t.id} turn={t} onRetry={() => runAgent(a)} onEdit={() => {}} />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {perms[0] && (
        <PermissionModal
          req={perms[0]}
          onResolve={(allow) => {
            const id = perms[0].id
            window.forge.agent.respondPermission(id, allow)
            setPerms((prev) => prev.slice(1))
          }}
        />
      )}
    </div>
  )
}

function Composer({
  model,
  permission,
  effort,
  commands,
  models,
  maxTurns,
  maxBudget,
  autoCompact,
  onResult,
  sessionId,
  sessionKey,
  onSession,
  onSetModel,
  onSetEffort,
  onSetPermission,
  onNewSession
}: {
  model?: string
  permission: Permission
  effort?: Effort
  commands: SlashCommand[]
  models: ModelInfo[]
  maxTurns: number
  maxBudget: number
  autoCompact: boolean
  onResult: (r: {
    costUsd?: number
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    contextTokens?: number
  }) => void
  sessionId: string | null
  sessionKey: number
  onSession: (id: string) => void
  onSetModel: (value: string) => void
  onSetEffort: (label: EffortLabel) => void
  onSetPermission: (p: Permission) => void
  onNewSession: () => void
}): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [perms, setPerms] = useState<PermReq[]>([])
  const [dialogs, setDialogs] = useState<DialogReq[]>([])
  const [menuIndex, setMenuIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [contextTokens, setContextTokens] = useState(0)
  const [contextModel, setContextModel] = useState('')
  const [compacting, setCompacting] = useState(false)
  const [history, setHistory] = useState<TranscriptItem[]>([])
  const [attachments, setAttachments] = useState<
    { id: string; mediaType: string; base64: string; preview: string; name: string }[]
  >([])
  const [histIndex, setHistIndex] = useState<number | null>(null)
  const promptHistRef = useRef<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const runIdRef = useRef<string | null>(null)
  const ownedRef = useRef<Set<string>>(new Set())
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult
  const onSessionRef = useRef(onSession)
  onSessionRef.current = onSession
  const sessionIdRef = useRef<string | null>(sessionId)
  sessionIdRef.current = sessionId
  const taRef = useRef<HTMLTextAreaElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  // Subscribe once; route streaming events to the matching turn. Ignore events
  // that belong to other views (e.g. Squad runs) so usage isn't double-counted.
  useEffect(() => {
    return window.forge.agent.onEvent((ev) => {
      if (!ownedRef.current.has(ev.runId)) return
      if (ev.type === 'session') {
        if (ev.runId === runIdRef.current) onSessionRef.current(ev.sessionId)
        return
      }
      if (ev.type === 'system') {
        if (ev.model) setContextModel(ev.model)
        return
      }
      if (ev.type === 'permission') {
        if (ev.runId === runIdRef.current) {
          setPerms((prev) => [...prev, { id: ev.id, toolName: ev.toolName, input: ev.input }])
        }
        return
      }
      if (ev.type === 'dialog') {
        if (ev.dialogKind === 'permission_ask_user_question' && ev.runId === runIdRef.current) {
          setDialogs((prev) => [
            ...prev,
            { id: ev.id, dialogKind: ev.dialogKind, payload: ev.payload, toolUseID: ev.toolUseID }
          ])
        } else {
          // Unknown kind or background run — deny so the subprocess proceeds.
          window.forge.agent.respondDialog(ev.id, {
            behavior: 'deny',
            message: 'Not answerable here'
          })
        }
        return
      }
      if (ev.type === 'result') {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === ev.runId
              ? {
                  ...t,
                  running: false,
                  meta: { costUsd: ev.costUsd, durationMs: ev.durationMs, error: ev.error }
                }
              : t
          )
        )
        if (ev.runId === runIdRef.current) {
          setPerms([])
          setDialogs([])
          taRef.current?.focus()
        }
        if (typeof ev.contextTokens === 'number') setContextTokens(ev.contextTokens)
        if (ev.ok) {
          onResultRef.current({
            costUsd: ev.costUsd,
            inputTokens: ev.inputTokens,
            outputTokens: ev.outputTokens,
            cacheReadTokens: ev.cacheReadTokens,
            contextTokens: ev.contextTokens
          })
        }
        return
      }
      // block-start / block-delta / tool-input / tool-result
      setTurns((prev) =>
        prev.map((t) => (t.id === ev.runId ? { ...t, blocks: reduceBlocks(t.blocks, ev) } : t))
      )
    })
  }, [])

  // Keep the transcript pinned to the bottom as content streams in.
  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns])

  // Load persisted prompt history once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('forge-prompt-history')
      if (raw) promptHistRef.current = JSON.parse(raw)
    } catch {
      /* ignore */
    }
  }, [])

  // Reset the visible transcript when starting a new / resumed conversation;
  // restore the past transcript when resuming an existing session.
  useEffect(() => {
    // Switching to another conversation orphans any run still streaming on this
    // one — interrupt it so it doesn't keep spending tokens (and cost) in the
    // background where its output can no longer be shown.
    if (runIdRef.current) window.forge.agent.interrupt(runIdRef.current)
    setTurns([])
    setPerms([])
    setDialogs([])
    setAttachments([])
    setContextTokens(0)
    setContextModel('')
    runIdRef.current = null
    const sid = sessionIdRef.current
    if (sid) {
      window.forge.agent
        .transcript(sid)
        .then((items) => {
          setHistory(items)
          // Seed the context gauge from the restored transcript (~4 chars/token)
          // so a resumed conversation doesn't read 0% until the next turn; the
          // next result event replaces this estimate with the exact token count.
          const chars = items.reduce(
            (n, it) =>
              n +
              (('text' in it && it.text) || '').length +
              (('result' in it && it.result) || '').length,
            0
          )
          if (chars > 0) setContextTokens(Math.round(chars / 4))
        })
        .catch(() => setHistory([]))
    } else {
      setHistory([])
    }
  }, [sessionKey])

  const running = turns.some((t) => t.running)

  // Task progress for the pinned bar above the composer. Models track work via
  // the Task tools (TaskCreate/TaskUpdate/TaskList), so reconstruct from those;
  // fall back to TodoWrite for any agent that still uses it.
  const taskTodos = deriveTasks(turns)
  let latestTodos: Todo[] | null = taskTodos.length ? taskTodos : null
  if (!latestTodos) {
    outer: for (let i = turns.length - 1; i >= 0; i--) {
      const blocks = turns[i].blocks
      for (let j = blocks.length - 1; j >= 0; j--) {
        const b = blocks[j]
        if (b.kind === 'tool' && b.name === 'TodoWrite') {
          const todos = parseTodos(b.inputRaw)
          if (todos && todos.length) {
            latestTodos = todos
            break outer
          }
        }
      }
    }
  }

  // Auto-compact when context crosses 80% (opt-in via the LIMITS toggle).
  useEffect(() => {
    if (!autoCompact || compacting || running || !sessionIdRef.current || contextTokens <= 0) return
    const pct = (contextTokens / ctxWindow(contextModel)) * 100
    if (pct >= 80) compact()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextTokens])

  async function send(textArg?: string): Promise<void> {
    const text = (textArg ?? prompt).trim()
    if (handleClientCommand(text)) return
    const atts = textArg ? [] : attachments // a retry does not re-attach images
    if ((!text && atts.length === 0) || running) return
    const id = crypto.randomUUID()
    runIdRef.current = id
    ownedRef.current.add(id)
    const previews = atts.map((a) => a.preview)
    setTurns((prev) => [
      ...prev,
      { id, prompt: text || '(image)', previews, blocks: [], meta: null, running: true }
    ])
    setHistIndex(null)
    if (!textArg) {
      setPrompt('')
      setAttachments([])
    }
    if (text) {
      const h = promptHistRef.current
      if (h[h.length - 1] !== text) {
        h.push(text)
        if (h.length > 100) h.shift()
        try {
          localStorage.setItem('forge-prompt-history', JSON.stringify(h))
        } catch {
          /* ignore */
        }
      }
    }
    const opts: import('../../main/agent').RunOptions = { permission }
    if (effort) opts.effort = effort
    if (model && model !== 'default') opts.model = model
    if (sessionIdRef.current) opts.resume = sessionIdRef.current
    if (atts.length) {
      opts.attachments = atts.map((a) => ({ mediaType: a.mediaType, base64: a.base64 }))
    }
    if (maxTurns > 0) opts.maxTurns = maxTurns
    if (maxBudget > 0) opts.maxBudgetUsd = maxBudget
    try {
      await window.forge.agent.start(id, text, opts)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, running: false, meta: { error: msg } } : t))
      )
    }
  }

  async function stop(): Promise<void> {
    if (runIdRef.current) await window.forge.agent.interrupt(runIdRef.current)
  }

  async function compact(): Promise<void> {
    const sid = sessionIdRef.current
    if (!sid || compacting || running) return
    setCompacting(true)
    try {
      const r = await window.forge.agent.compact(sid)
      if (r.ok) {
        onSessionRef.current(r.sessionId)
        pushNotice('⟲ /compact', '✓ Context compacted — older messages summarized.')
        setContextTokens(0)
      } else {
        pushNotice('⟲ /compact', `Compact failed${r.error ? ': ' + r.error : ''}`)
      }
    } finally {
      setCompacting(false)
    }
  }

  /** Show a local system note as a finished turn (no SDK call). */
  function pushNotice(cmd: string, msg: string): void {
    const id = crypto.randomUUID()
    setTurns((prev) => [
      ...prev,
      { id, prompt: cmd, previews: [], blocks: [{ kind: 'text', id: id + '-t', text: msg }], meta: null, running: false }
    ])
  }

  /**
   * Handle GUI-side slash commands that the headless SDK can't run
   * (/model, /effort, /permission, /clear, /help). Returns true if consumed.
   */
  function handleClientCommand(raw: string): boolean {
    const m = raw.match(/^\/(\S+)\s*(.*)$/)
    if (!m) return false
    const cmd = m[1].toLowerCase()
    const arg = m[2].trim()
    if (cmd === 'clear' || cmd === 'new') {
      onNewSession()
      setPrompt('')
      return true
    }
    if (cmd === 'help') {
      setShowHelp(true)
      setPrompt('')
      return true
    }
    if (cmd === 'model') {
      if (!arg) {
        pushNotice(
          raw,
          `Models: ${models.map((x) => x.value).join(', ')} — or any model ID, e.g. /model claude-opus-4-6`
        )
        setPrompt('')
        return true
      }
      const a = arg.toLowerCase()
      const found = models.find(
        (x) => x.value.toLowerCase() === a || x.displayName.toLowerCase().includes(a)
      )
      // Accept arbitrary model IDs (like the CLI). Resolve known aliases for a
      // friendlier label; otherwise pass the raw id straight to the SDK.
      const value = found ? found.value : arg
      onSetModel(value)
      pushNotice(
        raw,
        found ? `✓ Model → ${found.displayName} (${found.value})` : `✓ Model → ${value} (custom id)`
      )
      setPrompt('')
      return true
    }
    if (cmd === 'effort') {
      const lvl = arg.toUpperCase()
      if (['AUTO', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'].includes(lvl)) {
        onSetEffort(lvl as EffortLabel)
        pushNotice(raw, `✓ Effort → ${lvl}`)
      } else {
        pushNotice(raw, 'Effort: auto, low, medium, high, xhigh, max')
      }
      setPrompt('')
      return true
    }
    if (cmd === 'permission' || cmd === 'perm') {
      const map: Record<string, Permission> = {
        plan: 'plan',
        ask: 'ask',
        'auto-edit': 'acceptEdits',
        autoedit: 'acceptEdits',
        yolo: 'bypassPermissions'
      }
      const p = map[arg.toLowerCase()]
      if (p) {
        onSetPermission(p)
        pushNotice(raw, `✓ Permission → ${arg.toLowerCase()}`)
      } else {
        pushNotice(raw, 'Permission: plan, ask, auto-edit, yolo')
      }
      setPrompt('')
      return true
    }
    return false
  }

  function addFiles(files: FileList | null): void {
    if (!files) return
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result)
        const base64 = dataUrl.split(',')[1] ?? ''
        setAttachments((prev) => [
          ...prev,
          { id: crypto.randomUUID(), mediaType: file.type, base64, preview: dataUrl, name: file.name }
        ])
      }
      reader.readAsDataURL(file)
    }
  }

  // Slash-command autocomplete: active while typing "/name" (before any space).
  const slashQuery =
    prompt.startsWith('/') && !prompt.includes(' ') ? prompt.slice(1).toLowerCase() : null
  const matches: SlashCommand[] =
    slashQuery !== null && !dismissed
      ? [...CLIENT_COMMANDS, ...commands]
          .filter(
            (c) =>
              c.name.toLowerCase().startsWith(slashQuery) ||
              (c.aliases ?? []).some((a) => a.toLowerCase().startsWith(slashQuery))
          )
          .slice(0, 8)
      : []
  const menuOpen = matches.length > 0
  const menuSel = Math.min(menuIndex, matches.length - 1)

  function acceptCommand(cmd: SlashCommand): void {
    setPrompt('/' + cmd.name + ' ')
    setDismissed(false)
    setMenuIndex(0)
    taRef.current?.focus()
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMenuIndex((i) => (i + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMenuIndex((i) => (i - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        acceptCommand(matches[menuSel])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return
      }
    }
    // Prompt history recall (slash menu closed, caret at the very start).
    const ta = e.currentTarget
    if (e.key === 'ArrowUp' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      const h = promptHistRef.current
      if (h.length) {
        e.preventDefault()
        const idx = histIndex === null ? h.length - 1 : Math.max(0, histIndex - 1)
        setHistIndex(idx)
        setPrompt(h[idx])
        return
      }
    }
    if (e.key === 'ArrowDown' && histIndex !== null) {
      e.preventDefault()
      const h = promptHistRef.current
      const idx = histIndex + 1
      if (idx >= h.length) {
        setHistIndex(null)
        setPrompt('')
      } else {
        setHistIndex(idx)
        setPrompt(h[idx])
      }
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const idle = turns.length === 0
  const ctxPct =
    contextTokens > 0
      ? Math.min(100, Math.round((contextTokens / ctxWindow(contextModel)) * 100))
      : 0

  return (
    <div className="work">
      <div className="work-header">
        <div className="wh-left">
          <span className="wh-item">
            <span className="brand-mark">⚒</span> {model ?? 'default'}
          </span>
          <span className="wh-sep">·</span>
          <span className="wh-item">{permission}</span>
          <span className="wh-sep">·</span>
          <span className="wh-item">effort {effort ?? 'auto'}</span>
        </div>
        <div className="wh-right">
          {contextTokens > 0 && (
            <div
              className={`ctx-gauge ${ctxPct >= 70 ? 'hot' : ''}`}
              title={`${contextTokens.toLocaleString()} context tokens of ${ctxWindow(contextModel).toLocaleString()}`}
            >
              ctx {ctxPct}%
              <div className="ctx-bar">
                <div className="ctx-fill" style={{ width: ctxPct + '%' }} />
              </div>
            </div>
          )}
          {sessionId && (
            <button
              className="mini-btn"
              onClick={compact}
              disabled={compacting || running}
              title="Summarize older context to free tokens"
            >
              {compacting ? 'compacting…' : '⟲ compact'}
            </button>
          )}
        </div>
      </div>
      <div className="transcript" ref={transcriptRef}>
        <HistoryView items={history} />

        {idle && history.length === 0 && (
          <div className="anvil">
            <div className="anvil-mark">⚒</div>
            <div className="anvil-text">The anvil is ready. Describe the work.</div>
          </div>
        )}

        {turns.map((t) => (
          <TurnView
            key={t.id}
            turn={t}
            onRetry={() => send(t.prompt)}
            onEdit={() => {
              setPrompt(t.prompt)
              taRef.current?.focus()
            }}
          />
        ))}
      </div>

      {menuOpen && (
        <div className="slash-menu">
          {matches.map((c, i) => (
            <button
              key={c.name}
              className={`slash-item ${i === menuSel ? 'on' : ''}`}
              onMouseEnter={() => setMenuIndex(i)}
              onClick={() => acceptCommand(c)}
            >
              <span className="slash-name">
                /{c.name}
                {c.argumentHint ? <span className="slash-hint"> {c.argumentHint}</span> : null}
              </span>
              {c.description && <span className="slash-desc">{c.description}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="composer-wrap">
        {latestTodos && <TodoBar todos={latestTodos} />}
        {attachments.length > 0 && (
          <div className="attach-row">
            {attachments.map((a) => (
              <div className="attach-thumb" key={a.id} title={a.name}>
                <img src={a.preview} alt={a.name} />
                <button
                  className="attach-x"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer">
          <button
            className="attach-btn"
            title="Attach image"
            onClick={() => fileRef.current?.click()}
          >
            ＋
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <textarea
            ref={taRef}
            className="composer-input"
            placeholder="Describe the work…  (Enter send · Shift+Enter newline · / commands · ↑ history)"
            rows={3}
            autoFocus
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              setDismissed(false)
              setHistIndex(null)
            }}
            onKeyDown={onKey}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData.items).filter((it) =>
                it.type.startsWith('image/')
              )
              if (imgs.length) {
                e.preventDefault()
                const dt = new DataTransfer()
                imgs.forEach((it) => {
                  const f = it.getAsFile()
                  if (f) dt.items.add(f)
                })
                addFiles(dt.files)
              }
            }}
          />
          {running ? (
            <button className="stop" onClick={stop}>
              ■ STOP
            </button>
          ) : (
            <button
              className="primary send"
              disabled={!prompt.trim() && attachments.length === 0}
              onClick={() => send()}
            >
              Send
            </button>
          )}
        </div>
      </div>
      {running && <div className="forging">forging…</div>}

      {perms[0] && (
        <PermissionModal
          req={perms[0]}
          onResolve={(allow) => {
            const id = perms[0].id
            window.forge.agent.respondPermission(id, allow)
            setPerms((prev) => prev.slice(1))
          }}
        />
      )}

      {dialogs[0]?.dialogKind === 'permission_ask_user_question' && (
        <QuestionModal
          req={dialogs[0]}
          onSubmit={(result) => {
            window.forge.agent.respondDialog(dialogs[0].id, result)
            setDialogs((prev) => prev.slice(1))
          }}
          onCancel={() => {
            window.forge.agent.respondDialog(dialogs[0].id, {
              behavior: 'deny',
              message: 'User dismissed the question'
            })
            setDialogs((prev) => prev.slice(1))
          }}
        />
      )}

      {showHelp && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">COMMANDS</div>
            <div className="help-note">Handled by Forge (GUI):</div>
            {CLIENT_COMMANDS.map((c) => (
              <div className="help-row" key={c.name}>
                <span className="slash-name">
                  /{c.name}
                  {c.argumentHint ? ' ' + c.argumentHint : ''}
                </span>
                <span className="help-desc">{c.description}</span>
              </div>
            ))}
            <div className="help-note">
              Plus Claude commands (/usage, /cost, /compact…) and your skills — type / to browse.
              Interactive-only commands like /login or /agents aren't available in this environment.
            </div>
            <div className="modal-actions">
              <button className="primary" onClick={() => setShowHelp(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
