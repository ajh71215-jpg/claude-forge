// Reusable subagent manager panel (docs/MAINTAINABILITY.md Phase 1). Extracted
// verbatim from App.tsx — behavior-preserving. AgentDraft, AGENT_TEMPLATE and
// the AgentEditor modal travel WITH the panel.
import { useEffect, useState, type JSX } from 'react'
import Icon from '../Icon'
import { useConfirm } from '../ConfirmDialog'
import type { AgentMeta } from '../../types'
import { SKILL_NAME_RE } from './shared'

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
export default function AgentsPanel(): JSX.Element {
  const confirm = useConfirm()
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
    if (!(await confirm({ message: `Delete agent "${a.name}"? This removes its file.`, danger: true, confirmLabel: 'Delete' }))) return
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
          <div className="skills-empty-icon">
            <Icon name="agents" />
          </div>
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
