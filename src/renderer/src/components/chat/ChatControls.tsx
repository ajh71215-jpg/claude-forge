// Per-conversation Model / Effort / System-prompt controls (sits above the
// composer). Each chat tab can override the global sidebar defaults for THIS
// conversation only — the override is stored on the tab and persisted by session
// id, so it survives tab switches and restarts. Leaving a control on "Global"
// falls back to the sidebar selection (and to cost-saver routing when that's on).
import { useEffect, useRef, useState, type JSX } from 'react'
import type { EffortLabel, ModelInfo } from '../../types'
import { EFFORTS } from '../../lib/constants'

export default function ChatControls({
  models,
  globalModel,
  tabModel,
  onSetModel,
  globalEffort,
  tabEffort,
  onSetEffort,
  convPersona,
  onSetConvPersona,
  mcpServers,
  mcpScope,
  onSetMcpScope,
  costSaver
}: {
  models: ModelInfo[]
  /** The sidebar's global model selection (fallback when no per-chat override). */
  globalModel: string
  /** This conversation's model override, or undefined to use the global. */
  tabModel?: string
  onSetModel: (value: string) => void
  /** The sidebar's global effort selection (fallback). */
  globalEffort: EffortLabel
  /** This conversation's effort override, or undefined to use the global. */
  tabEffort?: EffortLabel
  onSetEffort: (value: EffortLabel | 'GLOBAL') => void
  convPersona?: string
  onSetConvPersona: (text: string | null) => void
  /** Names of the configured MCP servers (for the per-conversation scope control). */
  mcpServers: string[]
  /** This conversation's MCP scope (names to load); undefined ⇒ all servers. */
  mcpScope?: string[]
  /** Set/clear this conversation's MCP scope; null ⇒ all (default). */
  onSetMcpScope: (scope: string[] | null) => void
  /** Cost-saver routing is on — model/effort are chosen per prompt, so the manual
   * controls are disabled (mirrors the sidebar). */
  costSaver: boolean
}): JSX.Element {
  // The model that will actually run (override else global) drives which effort
  // levels are valid, so an unsupported level is never offered (e.g. Haiku).
  const effectiveModel = tabModel ?? globalModel
  const levels = models.find((m) => m.value === effectiveModel)?.supportedEffortLevels
  const effortSupported = (label: EffortLabel): boolean =>
    label === 'AUTO' || !levels || levels.includes(label.toLowerCase())

  const globalModelLabel =
    globalModel === 'default'
      ? 'Default'
      : (models.find((m) => m.value === globalModel)?.displayName ?? globalModel)

  const [personaOpen, setPersonaOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  // undefined scope ⇒ all servers load; a list ⇒ only those.
  const mcpActive = mcpScope ? mcpScope.length : mcpServers.length

  return (
    <div className={`chat-controls${costSaver ? ' dim' : ''}`}>
      <label className="cc-field" title="Model for THIS conversation (overrides the sidebar default)">
        <span className="cc-label">model</span>
        <select
          className="cc-select"
          disabled={costSaver}
          value={tabModel ?? 'global'}
          onChange={(e) => onSetModel(e.target.value)}
        >
          <option value="global">Global · {globalModelLabel}</option>
          {models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>

      <label className="cc-field" title="Reasoning effort for THIS conversation (overrides the sidebar default)">
        <span className="cc-label">effort</span>
        <select
          className="cc-select"
          disabled={costSaver}
          value={tabEffort ?? 'GLOBAL'}
          onChange={(e) => onSetEffort(e.target.value as EffortLabel | 'GLOBAL')}
        >
          <option value="GLOBAL">Global · {globalEffort.toLowerCase()}</option>
          {EFFORTS.map((eff) => (
            <option key={eff} value={eff} disabled={!effortSupported(eff)}>
              {eff.toLowerCase()}
            </option>
          ))}
        </select>
      </label>

      <button
        className={`cc-field cc-persona${convPersona ? ' on' : ''}`}
        title={
          convPersona
            ? `This conversation's system prompt:\n\n${convPersona}`
            : "Set a system prompt for THIS conversation (overrides the global agent)"
        }
        onClick={() => setPersonaOpen(true)}
      >
        <span className="cc-label">system prompt</span>
        <span className="cc-persona-state">{convPersona ? '✦ custom' : '— global'}</span>
      </button>

      {mcpServers.length > 0 && (
        <button
          className={`cc-field cc-persona${mcpScope ? ' on' : ''}`}
          title="Choose which MCP servers load for THIS conversation. Each server's tool definitions are re-sent every turn, so scoping to only what you need trims tokens (docs/TOKEN_OPTIMIZATION.md §10)."
          onClick={() => setMcpOpen(true)}
        >
          <span className="cc-label">mcp</span>
          <span className="cc-persona-state">
            {mcpScope ? `${mcpActive}/${mcpServers.length}` : '— all'}
          </span>
        </button>
      )}

      {personaOpen && (
        <PersonaEditor
          initial={convPersona ?? ''}
          onClose={() => setPersonaOpen(false)}
          onSave={(text) => {
            onSetConvPersona(text.trim() ? text : null)
            setPersonaOpen(false)
          }}
        />
      )}

      {mcpOpen && (
        <McpScopeEditor
          servers={mcpServers}
          scope={mcpScope}
          onClose={() => setMcpOpen(false)}
          onSave={(scope) => {
            onSetMcpScope(scope)
            setMcpOpen(false)
          }}
        />
      )}
    </div>
  )
}

/** Modal to pick which MCP servers load for THIS conversation. Saving the full
 *  set clears the scope (≡ "all", the default); a strict subset stores that list;
 *  none stores an empty list. */
function McpScopeEditor({
  servers,
  scope,
  onClose,
  onSave
}: {
  servers: string[]
  scope?: string[]
  onClose: () => void
  onSave: (scope: string[] | null) => void
}): JSX.Element {
  // undefined scope ⇒ all checked (default loads every server).
  const [sel, setSel] = useState<Set<string>>(() => new Set(scope ?? servers))
  const toggle = (name: string): void =>
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  const save = (): void => {
    const picked = servers.filter((s) => sel.has(s))
    // All selected ⇒ clear the override back to the default (load everything).
    onSave(picked.length === servers.length ? null : picked)
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal cc-persona-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">CONVERSATION MCP SERVERS</div>
        <div className="help-note">
          Only the checked servers load for this chat. Each server&apos;s tool definitions are
          re-sent on every turn, so unchecking ones you don&apos;t need here saves tokens. All
          checked ≡ the default (load everything).
        </div>
        <div className="cc-mcp-list">
          {servers.map((name) => (
            <label key={name} className="cc-mcp-row">
              <input type="checkbox" checked={sel.has(name)} onChange={() => toggle(name)} />
              <span>{name}</span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button className="mini-btn" onClick={() => setSel(new Set(servers))} title="Load all servers">
            All
          </button>
          <button className="mini-btn" onClick={() => setSel(new Set())} title="Load no MCP servers">
            None
          </button>
          <button className="mini-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/** Small modal to edit (or clear) THIS conversation's system-prompt override. */
function PersonaEditor({
  initial,
  onClose,
  onSave
}: {
  initial: string
  onClose: () => void
  onSave: (text: string) => void
}): JSX.Element {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal cc-persona-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">CONVERSATION SYSTEM PROMPT</div>
        <div className="help-note">
          Custom instructions for THIS conversation only — they replace the global agent
          persona for this chat. Leave empty to use the global agent.
        </div>
        <textarea
          ref={ref}
          className="cc-persona-input"
          rows={8}
          value={text}
          placeholder="e.g. You are a meticulous Rust reviewer. Answer in Korean. Prefer minimal diffs…"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="modal-actions">
          <button className="mini-btn" onClick={() => onSave('')} title="Clear and use the global agent">
            Clear
          </button>
          <button className="mini-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={() => onSave(text)}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
