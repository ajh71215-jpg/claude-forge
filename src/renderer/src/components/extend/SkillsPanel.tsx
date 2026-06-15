// Skills manager panel (docs/MAINTAINABILITY.md Phase 1). Extracted verbatim
// from App.tsx — behavior-preserving. The SkillDraft type, SKILL_TEMPLATE and
// the SkillEditor modal travel WITH the panel (file-private).
import { useEffect, useState, type JSX } from 'react'
import Icon from '../Icon'
import { useConfirm } from '../ConfirmDialog'
import type { SkillMeta } from '../../types'
import type { BundledSkillStatus } from '../../../../main/skillsPack'
import { SKILL_NAME_RE } from './shared'

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
export default function SkillsPanel(): JSX.Element {
  const confirm = useConfirm()
  const [skills, setSkills] = useState<SkillMeta[] | null>(null)
  const [pack, setPack] = useState<BundledSkillStatus[] | null>(null)
  const [editing, setEditing] = useState<SkillDraft | null>(null)
  const [busy, setBusy] = useState(false)

  function refresh(): void {
    window.forge.skills
      .list()
      .then(setSkills)
      .catch(() => setSkills([]))
    window.forge.skills
      .bundled()
      .then(setPack)
      .catch(() => setPack([]))
  }
  useEffect(refresh, [])

  async function install(name: string): Promise<void> {
    setBusy(true)
    try {
      const res = await window.forge.skills.install(name)
      if (res.ok) setSkills(res.skills)
      setPack(await window.forge.skills.bundled())
    } finally {
      setBusy(false)
    }
  }

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
    if (!(await confirm({ message: `Delete skill "${s.name}"? This permanently removes its files.`, danger: true, confirmLabel: 'Delete' }))) return
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
          <div className="skills-empty-icon">
            <Icon name="skills" />
          </div>
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

      {pack && pack.length > 0 && (
        <div className="skills-pack">
          <div className="skills-pack-head">
            <span className="skills-pack-title">Starter pack</span>
            <span className="skills-pack-sub">
              Battle-tested engineering skills · adapted from{' '}
              <code>mattpocock/skills</code> (MIT)
            </span>
          </div>
          {pack.map((b) => (
            <div key={b.name} className="skill-row" style={{ cursor: 'default' }}>
              <div className="skill-main" style={{ cursor: 'default' }}>
                <div className="skill-name">{b.name}</div>
                <div className="skill-desc">{b.description}</div>
              </div>
              <div className="skill-actions">
                {b.installed ? (
                  <span className="mcp-status-inline">installed</span>
                ) : (
                  <button
                    className="skill-act"
                    disabled={busy}
                    onClick={() => install(b.name)}
                  >
                    Install
                  </button>
                )}
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
