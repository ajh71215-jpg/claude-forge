// Local plugin-bundle manager panel (docs/MAINTAINABILITY.md Phase 1). Extracted
// verbatim from App.tsx — behavior-preserving.
import { useEffect, useState, type JSX } from 'react'
import Icon from '../Icon'
import { useConfirm } from '../ConfirmDialog'
import type { PluginEntry } from '../../types'

/** Local plugin bundles passed to the SDK `plugins` option. */
export default function PluginsPanel({ onChanged }: { onChanged?: () => void }): JSX.Element {
  const confirm = useConfirm()
  const [plugins, setPlugins] = useState<PluginEntry[] | null>(null)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function refresh(): void {
    window.forge.plugins
      .list()
      .then(setPlugins)
      .catch(() => setPlugins([]))
  }
  useEffect(refresh, [])

  async function add(): Promise<void> {
    const p = path.trim()
    if (!p) return
    setBusy(true)
    setError(null)
    try {
      const res = await window.forge.plugins.add(p)
      if (res.ok) {
        setPlugins(res.plugins)
        setPath('')
        onChanged?.()
      } else setError(res.error)
    } finally {
      setBusy(false)
    }
  }
  async function toggle(p: PluginEntry): Promise<void> {
    setBusy(true)
    try {
      setPlugins(await window.forge.plugins.toggle(p.path, !p.enabled))
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }
  async function remove(p: PluginEntry): Promise<void> {
    if (!(await confirm({ message: `Unregister plugin?\n${p.path}`, danger: true, confirmLabel: 'Unregister' }))) return
    setBusy(true)
    try {
      setPlugins(await window.forge.plugins.remove(p.path))
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="skills-panel">
      <div className="skills-head">
        <div>
          <div className="skills-title">PLUGINS</div>
          <div className="skills-sub">
            Local plugin bundles (a dir with <code>.claude-plugin/plugin.json</code>) — skills,
            commands, hooks &amp; agents in one package
          </div>
        </div>
      </div>

      <div className="plugin-add">
        <input
          className={`skill-input ${error ? 'bad' : ''}`}
          value={path}
          placeholder="C:\path\to\plugin-dir"
          spellCheck={false}
          onChange={(e) => {
            setPath(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <button className="primary skills-new" disabled={!path.trim() || busy} onClick={add}>
          + Add
        </button>
      </div>
      {error && <div className="skill-error" style={{ marginBottom: 12 }}>{error}</div>}

      {plugins === null ? (
        <div className="skills-empty">loading…</div>
      ) : plugins.length === 0 ? (
        <div className="skills-empty">
          <div className="skills-empty-icon">
            <Icon name="plugins" />
          </div>
          <div className="skills-empty-title">No plugins registered</div>
          <div className="skills-empty-desc">
            Point Forge at a local plugin directory to load its bundled extensions on each run.
          </div>
        </div>
      ) : (
        <div className="skill-list">
          {plugins.map((p) => (
            <div key={p.path} className={`skill-row ${p.enabled ? '' : 'off'}`}>
              <button
                className={`skill-switch ${p.enabled ? 'on' : ''}`}
                title={p.enabled ? 'Enabled' : 'Disabled'}
                disabled={busy}
                onClick={() => toggle(p)}
              >
                <span className="skill-knob" />
              </button>
              <div className="skill-main" style={{ cursor: 'default' }}>
                <div className="skill-name">
                  {p.manifestName || p.path.replace(/^.*[\\/]/, '')}
                  {!p.exists ? (
                    <span className="mcp-status-inline" style={{ color: 'var(--danger)' }}>
                      missing
                    </span>
                  ) : p.error ? (
                    <span className="mcp-status-inline">{p.error}</span>
                  ) : (
                    <span className="mcp-status-inline">ok</span>
                  )}
                </div>
                <div className="skill-desc">{p.path}</div>
              </div>
              <div className="skill-actions">
                <button className="skill-act danger" disabled={busy} onClick={() => remove(p)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
