// Free / cheaper provider manager panel (docs/GOOSE_INTEGRATION.md). Lets the
// user register goose-routed providers (OpenRouter / Gemini / Groq / Ollama) the
// orchestrator can delegate simple subtasks to. Mirrors McpPanel — secrets persist
// to forge-providers.json (outside .claude/). Privacy: a delegated subtask's
// content is sent to that provider; this is opt-in by configuring one here.
import { useEffect, useState, type JSX } from 'react'
import Icon from '../Icon'
import { useConfirm } from '../ConfirmDialog'
import type { ProviderEntry } from '../../types'

/** goose provider id → default key env + a sensible default model + free flag.
 * These are convenience presets; "custom" lets you add ANY provider goose
 * supports (Cerebras, Mistral, Together, Fireworks, …) by typing its GOOSE_PROVIDER
 * id + API-key env var. See goose's provider docs for ids/models. */
const PRESETS: Record<string, { keyEnv: string; model: string; free: boolean; label: string }> = {
  openrouter: { keyEnv: 'OPENROUTER_API_KEY', model: 'qwen/qwen3-coder:free', free: true, label: 'OpenRouter (:free models)' },
  google: { keyEnv: 'GOOGLE_API_KEY', model: 'gemini-2.0-flash', free: true, label: 'Google Gemini (daily free tier)' },
  groq: { keyEnv: 'GROQ_API_KEY', model: 'llama-3.3-70b-versatile', free: true, label: 'Groq (daily free tier)' },
  ollama: { keyEnv: '', model: 'qwen2.5-coder', free: true, label: 'Ollama (local, free)' }
}
const CUSTOM = 'custom'

interface Draft {
  originalId?: string
  id: string
  gooseProvider: string
  defaultModel: string
  apiKey: string
  ollamaHost: string
  free: boolean
  enabled: boolean
}

function entryToDraft(e: ProviderEntry): Draft {
  return {
    originalId: e.id,
    id: e.id,
    gooseProvider: e.gooseProvider,
    defaultModel: e.defaultModel,
    apiKey: '',
    ollamaHost: e.ollamaHost ?? '',
    free: e.free,
    enabled: e.enabled
  }
}

/** Provider manager — add/edit/remove free-tier providers for delegation. */
export default function ProvidersPanel(): JSX.Element {
  const confirm = useConfirm()
  const [providers, setProviders] = useState<ProviderEntry[] | null>(null)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  function refresh(): void {
    window.forge.providers.list().then(setProviders).catch(() => setProviders([]))
  }
  useEffect(refresh, [])

  async function remove(id: string): Promise<void> {
    if (!(await confirm({ message: `Remove provider "${id}"?`, danger: true, confirmLabel: 'Remove' }))) return
    setBusy(true)
    try {
      setProviders(await window.forge.providers.delete(id))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="skills-panel">
      <div className="skills-head">
        <div>
          <div className="skills-title">PROVIDERS</div>
          <div className="skills-sub">
            Free / cheaper models the orchestrator delegates simple subtasks to (via goose) ·
            content leaves your machine to the provider
          </div>
        </div>
        <button
          className="primary skills-new"
          onClick={() =>
            setEditing({
              id: '',
              gooseProvider: 'openrouter',
              defaultModel: PRESETS.openrouter.model,
              apiKey: '',
              ollamaHost: '',
              free: true,
              enabled: true
            })
          }
        >
          + Add provider
        </button>
      </div>

      {providers === null ? (
        <div className="skills-empty">loading…</div>
      ) : providers.length === 0 ? (
        <div className="skills-empty">
          <div className="skills-empty-icon">
            <Icon name="mcp" />
          </div>
          <div className="skills-empty-title">No providers</div>
          <div className="skills-empty-desc">
            Add a free provider (OpenRouter, Gemini, Groq, or local Ollama). Once enabled, Claude can
            offload simple subtasks to it via the <code>delegate</code> tool to save budget.
          </div>
        </div>
      ) : (
        <div className="skill-list">
          {providers.map((p) => (
            <div key={p.id} className="skill-row">
              <span className={`mcp-dot ${p.enabled ? 'ok' : ''}`} title={p.enabled ? 'enabled' : 'disabled'} />
              <button className="skill-main" onClick={() => setEditing(entryToDraft(p))}>
                <div className="skill-name">
                  {p.id}
                  <span className="mcp-transport">{p.gooseProvider}</span>
                  {p.free ? <span className="mcp-status-inline">free</span> : null}
                </div>
                <div className="skill-desc">{p.defaultModel}</div>
              </button>
              <div className="skill-actions">
                <button className="skill-act" onClick={() => setEditing(entryToDraft(p))}>
                  Edit
                </button>
                <button className="skill-act danger" disabled={busy} onClick={() => remove(p.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ProviderEditor
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={(list) => {
            setProviders(list)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function ProviderEditor({
  draft,
  onClose,
  onSaved
}: {
  draft: Draft
  onClose: () => void
  onSaved: (providers: ProviderEntry[]) => void
}): JSX.Element {
  const isNew = !draft.originalId
  const presetMatch = PRESETS[draft.gooseProvider] ? draft.gooseProvider : CUSTOM
  const [id, setId] = useState(draft.id)
  const [mode, setMode] = useState(presetMatch) // dropdown value: preset key | 'custom'
  const [customProvider, setCustomProvider] = useState(presetMatch === CUSTOM ? draft.gooseProvider : '')
  const [customKeyEnv, setCustomKeyEnv] = useState('')
  const [defaultModel, setDefaultModel] = useState(draft.defaultModel)
  const [apiKey, setApiKey] = useState(draft.apiKey)
  const [ollamaHost, setOllamaHost] = useState(draft.ollamaHost)
  const [free, setFree] = useState(draft.free)
  const [enabled, setEnabled] = useState(draft.enabled)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const isCustom = mode === CUSTOM
  const gooseProvider = (isCustom ? customProvider : mode).trim().toLowerCase()
  const keyEnv = isCustom ? customKeyEnv.trim() : PRESETS[mode]?.keyEnv ?? ''
  const idOk = /^[A-Za-z0-9_-]{1,64}$/.test(id.trim())
  const isOllama = gooseProvider === 'ollama'
  const needsKey = !isOllama && isNew
  const canSave =
    idOk &&
    gooseProvider.length > 0 &&
    defaultModel.trim().length > 0 &&
    (isOllama || keyEnv.length > 0) &&
    (!needsKey || apiKey.trim().length > 0)

  function onPick(next: string): void {
    setMode(next)
    const preset = PRESETS[next]
    if (preset) {
      setFree(preset.free)
      // Fill the model when empty or still a previous preset's default.
      if (!defaultModel.trim() || Object.values(PRESETS).some((p) => p.model === defaultModel)) {
        setDefaultModel(preset.model)
      }
    }
  }

  async function save(): Promise<void> {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await window.forge.providers.save({
        originalId: draft.originalId,
        id: id.trim(),
        gooseProvider,
        defaultModel: defaultModel.trim(),
        apiKeyEnv: keyEnv || undefined,
        apiKey: apiKey.trim() || undefined,
        ollamaHost: ollamaHost.trim() || undefined,
        free,
        enabled
      })
      if (res.ok) onSaved(res.providers)
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
        <div className="modal-title">{isNew ? 'ADD PROVIDER' : `EDIT · ${draft.originalId}`}</div>

        <div className="hook-grid">
          <label className="skill-field" style={{ marginBottom: 0 }}>
            <span className="skill-flabel">Id</span>
            <input
              className={`skill-input ${id && !idOk ? 'bad' : ''}`}
              value={id}
              placeholder="openrouter-free"
              spellCheck={false}
              onChange={(e) => setId(e.target.value)}
              autoFocus={isNew}
            />
          </label>
          <label className="skill-field" style={{ marginBottom: 0 }}>
            <span className="skill-flabel">Provider</span>
            <select
              className="skill-input hook-select"
              value={mode}
              onChange={(e) => onPick(e.target.value)}
            >
              {Object.entries(PRESETS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
              <option value={CUSTOM}>Custom (any goose provider)…</option>
            </select>
          </label>
        </div>

        {isCustom && (
          <div className="hook-grid">
            <label className="skill-field" style={{ marginBottom: 0 }}>
              <span className="skill-flabel">
                GOOSE_PROVIDER <span className="skill-hint">goose provider id</span>
              </span>
              <input
                className="skill-input"
                value={customProvider}
                placeholder="cerebras / mistral / together / …"
                spellCheck={false}
                onChange={(e) => setCustomProvider(e.target.value)}
              />
            </label>
            <label className="skill-field" style={{ marginBottom: 0 }}>
              <span className="skill-flabel">
                API key env <span className="skill-hint">var goose reads</span>
              </span>
              <input
                className="skill-input"
                value={customKeyEnv}
                placeholder="CEREBRAS_API_KEY"
                spellCheck={false}
                onChange={(e) => setCustomKeyEnv(e.target.value)}
              />
            </label>
          </div>
        )}

        <label className="skill-field">
          <span className="skill-flabel">
            Default model <span className="skill-hint">GOOSE_MODEL value</span>
          </span>
          <input
            className="skill-input"
            value={defaultModel}
            placeholder="qwen/qwen3-coder:free"
            spellCheck={false}
            onChange={(e) => setDefaultModel(e.target.value)}
          />
        </label>

        {isOllama ? (
          <label className="skill-field">
            <span className="skill-flabel">
              Ollama host <span className="skill-hint">optional · default http://localhost:11434</span>
            </span>
            <input
              className="skill-input"
              value={ollamaHost}
              placeholder="http://localhost:11434"
              spellCheck={false}
              onChange={(e) => setOllamaHost(e.target.value)}
            />
          </label>
        ) : (
          <label className="skill-field">
            <span className="skill-flabel">
              API key{' '}
              <span className="skill-hint">
                {keyEnv || 'env var'} · {isNew ? 'required' : 'leave blank to keep'}
              </span>
            </span>
            <input
              className="skill-input"
              type="password"
              value={apiKey}
              placeholder="sk-..."
              spellCheck={false}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
        )}

        <div className="hook-grid">
          <label className="skill-field" style={{ marginBottom: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
            <span className="skill-flabel" style={{ margin: 0 }}>Prefer for easy subtasks (free)</span>
          </label>
          <label className="skill-field" style={{ marginBottom: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span className="skill-flabel" style={{ margin: 0 }}>Enabled</span>
          </label>
        </div>

        {error && <div className="skill-error">{error}</div>}
        <div className="skill-note">
          Stored in Forge config (not in <code>.claude/</code>). When ≥1 provider is enabled, the{' '}
          <code>delegate</code> tool is offered to the model. Delegated subtask content is sent to
          this provider.
        </div>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!canSave || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save provider'}
          </button>
        </div>
      </div>
    </div>
  )
}
