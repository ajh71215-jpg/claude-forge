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
