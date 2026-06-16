// Custom slash-command manager panel (docs/MAINTAINABILITY.md Phase 1).
// Extracted verbatim from App.tsx — behavior-preserving. CommandDraft,
// COMMAND_TEMPLATE and the CommandEditor modal travel WITH the panel.
import { useEffect, useState, type JSX } from 'react'
import Icon from '../Icon'
import { useConfirm } from '../ConfirmDialog'
import type { CommandMeta } from '../../types'
import { SKILL_NAME_RE } from './shared'

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
export default function CommandsPanel({ onChanged }: { onChanged?: () => void }): JSX.Element {
  const confirm = useConfirm()
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
    if (!(await confirm({ message: `Delete command "/${c.name}"? This removes its file.`, danger: true, confirmLabel: 'Delete' }))) return
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
          <div className="skills-empty-icon">
            <Icon name="commands" />
          </div>
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
