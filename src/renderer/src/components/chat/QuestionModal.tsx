// Interactive UI for the AskUserQuestion tool (docs/MAINTAINABILITY.md Phase 2).
// Extracted verbatim from App.tsx — behavior-preserving.
import { useState, type JSX } from 'react'
import type { DialogReq, DialogQuestion, QResult } from '../../types'

/**
 * Interactive UI for the AskUserQuestion tool (dialogKind
 * 'permission_ask_user_question'). On submit we return the PermissionResult the
 * CLI expects: { behavior:'allow', updatedInput:{ questions, answers, annotations } }
 * where answers maps each question string to the chosen label(s).
 */
export default function QuestionModal({
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
