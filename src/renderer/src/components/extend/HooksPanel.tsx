// Hooks manager panel (docs/MAINTAINABILITY.md Phase 1). Extracted verbatim
// from App.tsx — behavior-preserving. HOOK_EVENTS travels WITH the panel.
import { useEffect, useState, type JSX } from 'react'
import Icon from '../Icon'
import type { HookRule } from '../../types'

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
export default function HooksPanel(): JSX.Element {
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
          <div className="skills-empty-icon">
            <Icon name="hooks" />
          </div>
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
