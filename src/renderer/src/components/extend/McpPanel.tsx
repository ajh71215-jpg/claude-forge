// MCP server manager panel (docs/MAINTAINABILITY.md Phase 1). Extracted verbatim
// from App.tsx — behavior-preserving. McpDraft, entryToDraft, parseLines and the
// McpEditor modal travel WITH the panel.
import { useEffect, useState, type JSX } from 'react'
import Icon from '../Icon'
import { useConfirm } from '../ConfirmDialog'
import type { McpServer, McpServerEntry, McpTransport } from '../../types'
import { mcpStatusClass } from '../../lib/format'

interface McpDraft {
  originalName?: string
  name: string
  transport: McpTransport
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
}

function entryToDraft(e: McpServerEntry): McpDraft {
  return {
    originalName: e.name,
    name: e.name,
    transport: e.transport,
    command: e.command ?? '',
    argsText: (e.args ?? []).join('\n'),
    envText: Object.entries(e.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
    url: e.url ?? '',
    headersText: Object.entries(e.headers ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
  }
}

/** MCP server manager — add/edit/remove servers + live connection status. */
export default function McpPanel({
  status,
  onChanged
}: {
  status: McpServer[]
  onChanged?: () => void
}): JSX.Element {
  const confirm = useConfirm()
  const [servers, setServers] = useState<McpServerEntry[] | null>(null)
  const [editing, setEditing] = useState<McpDraft | null>(null)
  const [busy, setBusy] = useState(false)

  function refresh(): void {
    window.forge.mcp
      .list()
      .then(setServers)
      .catch(() => setServers([]))
  }
  useEffect(refresh, [])

  const statusByName = new Map(status.map((s) => [s.name, s.status]))

  async function remove(name: string): Promise<void> {
    if (!(await confirm({ message: `Remove MCP server "${name}"?`, danger: true, confirmLabel: 'Remove' }))) return
    setBusy(true)
    try {
      setServers(await window.forge.mcp.delete(name))
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="skills-panel">
      <div className="skills-head">
        <div>
          <div className="skills-title">MCP SERVERS</div>
          <div className="skills-sub">
            Model Context Protocol servers Forge connects on each run · stdio / http / sse
          </div>
        </div>
        <div className="hooks-head-actions">
          <button className="skill-act" onClick={() => onChanged?.()} title="Re-probe connections">
            Test connections
          </button>
          <button
            className="primary skills-new"
            onClick={() =>
              setEditing({
                name: '',
                transport: 'stdio',
                command: '',
                argsText: '',
                envText: '',
                url: '',
                headersText: ''
              })
            }
          >
            + Add server
          </button>
        </div>
      </div>

      {servers === null ? (
        <div className="skills-empty">loading…</div>
      ) : servers.length === 0 ? (
        <div className="skills-empty">
          <div className="skills-empty-icon">
            <Icon name="mcp" />
          </div>
          <div className="skills-empty-title">No MCP servers</div>
          <div className="skills-empty-desc">
            Add a server to give the agent extra tools — a local stdio process or a remote http/sse
            endpoint.
          </div>
        </div>
      ) : (
        <div className="skill-list">
          {servers.map((s) => {
            const st = statusByName.get(s.name)
            return (
              <div key={s.name} className="skill-row">
                <span
                  className={`mcp-dot ${st ? mcpStatusClass(st) : ''}`}
                  title={st ?? 'not yet probed'}
                />
                <button className="skill-main" onClick={() => setEditing(entryToDraft(s))}>
                  <div className="skill-name">
                    {s.name}
                    <span className="mcp-transport">{s.transport}</span>
                    {st ? <span className="mcp-status-inline">{st}</span> : null}
                  </div>
                  <div className="skill-desc">
                    {s.transport === 'stdio'
                      ? [s.command, ...(s.args ?? [])].filter(Boolean).join(' ') || 'No command'
                      : s.url || 'No URL'}
                  </div>
                </button>
                <div className="skill-actions">
                  <button className="skill-act" onClick={() => setEditing(entryToDraft(s))}>
                    Edit
                  </button>
                  <button
                    className="skill-act danger"
                    disabled={busy}
                    onClick={() => remove(s.name)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <McpEditor
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={(list) => {
            setServers(list)
            setEditing(null)
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}

function parseLines(text: string, sep: RegExp): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const m = t.match(sep)
    if (m) out[m[1].trim()] = m[2].trim()
  }
  return out
}

function McpEditor({
  draft,
  onClose,
  onSaved
}: {
  draft: McpDraft
  onClose: () => void
  onSaved: (servers: McpServerEntry[]) => void
}): JSX.Element {
  const isNew = !draft.originalName
  const [name, setName] = useState(draft.name)
  const [transport, setTransport] = useState<McpTransport>(draft.transport)
  const [command, setCommand] = useState(draft.command)
  const [argsText, setArgsText] = useState(draft.argsText)
  const [envText, setEnvText] = useState(draft.envText)
  const [url, setUrl] = useState(draft.url)
  const [headersText, setHeadersText] = useState(draft.headersText)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const nameOk = /^[A-Za-z0-9_-]{1,64}$/.test(name.trim())
  const stdio = transport === 'stdio'
  const canSave =
    nameOk && (stdio ? command.trim().length > 0 : /^https?:\/\//i.test(url.trim()))

  async function save(): Promise<void> {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await window.forge.mcp.save({
        originalName: draft.originalName,
        name: name.trim(),
        transport,
        command: command.trim(),
        args: argsText.split(/\r?\n/).map((a) => a.trim()).filter(Boolean),
        env: parseLines(envText, /^([^=]+)=(.*)$/),
        url: url.trim(),
        headers: parseLines(headersText, /^([^:]+):(.*)$/)
      })
      if (res.ok) onSaved(res.servers)
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
        <div className="modal-title">{isNew ? 'ADD MCP SERVER' : `EDIT · ${draft.originalName}`}</div>

        <div className="hook-grid">
          <label className="skill-field" style={{ marginBottom: 0 }}>
            <span className="skill-flabel">Name</span>
            <input
              className={`skill-input ${name && !nameOk ? 'bad' : ''}`}
              value={name}
              placeholder="my-server"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              autoFocus={isNew}
            />
          </label>
          <label className="skill-field" style={{ marginBottom: 0 }}>
            <span className="skill-flabel">Transport</span>
            <select
              className="skill-input hook-select"
              value={transport}
              onChange={(e) => setTransport(e.target.value as McpTransport)}
            >
              <option value="stdio">stdio (local process)</option>
              <option value="http">http (remote)</option>
              <option value="sse">sse (remote)</option>
            </select>
          </label>
        </div>

        {stdio ? (
          <>
            <label className="skill-field">
              <span className="skill-flabel">
                Command <span className="skill-hint">executable to spawn</span>
              </span>
              <input
                className="skill-input"
                value={command}
                placeholder="npx"
                spellCheck={false}
                onChange={(e) => setCommand(e.target.value)}
              />
            </label>
            <label className="skill-field">
              <span className="skill-flabel">
                Args <span className="skill-hint">one per line</span>
              </span>
              <textarea
                className="skill-body"
                style={{ minHeight: 80 }}
                value={argsText}
                rows={3}
                spellCheck={false}
                placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path'}
                onChange={(e) => setArgsText(e.target.value)}
              />
            </label>
            <label className="skill-field">
              <span className="skill-flabel">
                Env <span className="skill-hint">KEY=value per line · optional</span>
              </span>
              <textarea
                className="skill-body"
                style={{ minHeight: 64 }}
                value={envText}
                rows={2}
                spellCheck={false}
                placeholder={'API_KEY=...'}
                onChange={(e) => setEnvText(e.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label className="skill-field">
              <span className="skill-flabel">URL</span>
              <input
                className={`skill-input ${url && !/^https?:\/\//i.test(url) ? 'bad' : ''}`}
                value={url}
                placeholder="https://example.com/mcp"
                spellCheck={false}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label className="skill-field">
              <span className="skill-flabel">
                Headers <span className="skill-hint">Key: Value per line · optional</span>
              </span>
              <textarea
                className="skill-body"
                style={{ minHeight: 80 }}
                value={headersText}
                rows={3}
                spellCheck={false}
                placeholder={'Authorization: Bearer ...'}
                onChange={(e) => setHeadersText(e.target.value)}
              />
            </label>
          </>
        )}

        {error && <div className="skill-error">{error}</div>}
        <div className="skill-note">
          Stored in Forge config (not in <code>.claude/</code>) and connected via the SDK on each
          run. Status appears after the next run or “Test connections”.
        </div>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!canSave || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save server'}
          </button>
        </div>
      </div>
    </div>
  )
}
