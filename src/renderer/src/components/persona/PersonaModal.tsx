// Editor for the global custom system-prompt persona (docs/MAINTAINABILITY.md
// Phase 3). Extracted verbatim from App.tsx — behavior-preserving. The preset
// chips travel WITH the modal.
import { useState, type JSX } from 'react'
import type { Persona } from '../../types'

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
export default function PersonaModal({
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
