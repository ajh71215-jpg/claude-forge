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
  const [view, setView] = useState<'chat' | 'squad'>('chat')
  const [persona, setPersonaState] = useState<Persona | null>(null)
  const [showPersona, setShowPersona] = useState(false)

  function refreshSessions(): void {
    window.forge.agent.sessions().then(setSessions).catch(() => {})
  }
  function refreshUsage(): void {
    window.forge.agent.usage().then(setSubUsage).catch(() => {})
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
            {EFFORTS.map((e) => (
              <button
                key={e}
                className={`effort-cell ${!costSaver && effort === e ? 'on' : ''}`}
                onClick={() => chooseEffort(e)}
              >
                {e}
              </button>
            ))}
          </div>
          {costSaver ? (
            <div className="selector-hint">overridden by cost-saver → low</div>
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
    case 'WebFetch':
    case 'WebSearch':
      return '∮'
    default:
      return '⛏'
  }
}

function toolArgObj(input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>
  return String(o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? o.description ?? '')
}

function toolArg(inputRaw: string): string {
  try {
    return toolArgObj(JSON.parse(inputRaw))
  } catch {
    return ''
  }
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

/** Rough context window by model id ([1m] variants = 1M, else 200k). */
function ctxWindow(model: string): number {
  if (model.includes('[1m]')) return 1_000_000
  return model ? 200_000 : 1_000_000
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
    if (a.model) opts.model = a.model
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
    setTurns([])
    setPerms([])
    setAttachments([])
    setContextTokens(0)
    setContextModel('')
    runIdRef.current = null
    const sid = sessionIdRef.current
    if (sid) {
      window.forge.agent
        .transcript(sid)
        .then(setHistory)
        .catch(() => setHistory([]))
    } else {
      setHistory([])
    }
  }, [sessionKey])

  const running = turns.some((t) => t.running)

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
    if (model) opts.model = model
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
