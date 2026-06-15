// Project-memory panel (agentmemory absorption). Browse/search the facts Forge
// auto-captures from tool use across sessions, toggle the subsystem, and prune.
// Recall (injection at conversation start) is automatic; this panel is the
// human-inspectable window onto what's stored — local reads only, no tokens.
import { useEffect, useMemo, useState, type JSX } from 'react'
import Icon from '../Icon'
import { useConfirm } from '../ConfirmDialog'
import type { MemoryEntry } from '../../types'

const KIND_LABEL: Record<string, string> = {
  working: 'working',
  episodic: 'episodic',
  semantic: 'semantic',
  procedural: 'procedural'
}

export default function MemoryPanel(): JSX.Element {
  const confirm = useConfirm()
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null)
  const [enabled, setEnabled] = useState<boolean>(true)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  function refresh(q = query): void {
    const p = q.trim() ? window.forge.memory.search(q) : window.forge.memory.list()
    p.then(setEntries).catch(() => setEntries([]))
  }
  useEffect(() => {
    window.forge.memory.enabled().then(setEnabled).catch(() => {})
    refresh('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggle(): Promise<void> {
    setBusy(true)
    try {
      setEnabled(await window.forge.memory.setEnabled(!enabled))
    } finally {
      setBusy(false)
    }
  }
  async function del(id: string): Promise<void> {
    setBusy(true)
    try {
      setEntries(await window.forge.memory.delete(id))
    } finally {
      setBusy(false)
    }
  }
  async function clearAll(): Promise<void> {
    if (!(await confirm({ message: 'Forget ALL captured project memory?', danger: true, confirmLabel: 'Forget all' }))) return
    setBusy(true)
    try {
      setEntries(await window.forge.memory.clear())
    } finally {
      setBusy(false)
    }
  }

  const count = entries?.length ?? 0
  const byKind = useMemo(() => {
    const m: Record<string, number> = {}
    for (const e of entries ?? []) m[e.kind] = (m[e.kind] ?? 0) + 1
    return m
  }, [entries])

  return (
    <div className="skills-panel">
      <div className="skills-head">
        <div>
          <div className="skills-title">MEMORY</div>
          <div className="skills-sub">
            Facts Forge auto-captures from tool use (file edits, commands) and recalls — compressed,
            budget-bounded — at the start of new conversations, so the agent re-explains less. Local
            only · zero extra tokens · secrets stripped before storage.
          </div>
        </div>
        <button
          className={`skill-switch ${enabled ? 'on' : ''}`}
          title={enabled ? 'Memory on' : 'Memory off'}
          disabled={busy}
          onClick={toggle}
        >
          <span className="skill-knob" />
        </button>
      </div>

      <div className="plugin-add">
        <input
          className="skill-input"
          value={query}
          placeholder="Search memory (BM25)…"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value)
            refresh(e.target.value)
          }}
        />
        {count > 0 && (
          <button className="skill-act danger" disabled={busy} onClick={clearAll}>
            Forget all
          </button>
        )}
      </div>

      {count > 0 && (
        <div className="skills-sub" style={{ marginBottom: 10 }}>
          {count} memories
          {Object.keys(byKind).length > 0 && (
            <span>
              {' '}
              ·{' '}
              {Object.entries(byKind)
                .map(([k, n]) => `${n} ${KIND_LABEL[k] ?? k}`)
                .join(' · ')}
            </span>
          )}
        </div>
      )}

      {entries === null ? (
        <div className="skills-empty">loading…</div>
      ) : entries.length === 0 ? (
        <div className="skills-empty">
          <div className="skills-empty-icon">
            <Icon name="agents" />
          </div>
          <div className="skills-empty-title">{query.trim() ? 'No matches' : 'No memories yet'}</div>
          <div className="skills-empty-desc">
            {query.trim()
              ? 'Try a different search.'
              : 'As the agent edits files and runs commands, durable facts appear here automatically and are recalled in later sessions.'}
          </div>
        </div>
      ) : (
        <div className="skill-list">
          {entries.map((e) => (
            <div key={e.id} className="skill-row" style={{ cursor: 'default' }}>
              <span className={`mem-kind mem-${e.kind}`}>{KIND_LABEL[e.kind] ?? e.kind}</span>
              <div className="skill-main" style={{ cursor: 'default' }}>
                <div className="skill-name">{e.text}</div>
                <div className="skill-desc">
                  {e.source}
                  {e.tags.length > 0 && <span> · {e.tags.join(' · ')}</span>}
                  {e.accessCount > 0 && <span> · recalled ×{e.accessCount}</span>}
                </div>
              </div>
              <div className="skill-actions">
                <button className="skill-act danger" disabled={busy} onClick={() => del(e.id)}>
                  Forget
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
