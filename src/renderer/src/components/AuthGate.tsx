import { useState, type JSX } from 'react'

type Method = 'subscription' | 'api-key'

/**
 * First-run gate. Lets you connect the way you already use Claude Code — your
 * Claude subscription — or with a BYO Anthropic API key.
 *
 * - Subscription (existing login): reuses ~/.claude/.credentials.json. Nothing
 *   is stored by Forge; the SDK subprocess uses the same login as the CLI.
 * - Subscription (setup-token): paste a CLAUDE_CODE_OAUTH_TOKEN from
 *   `claude setup-token` (portable, no prior login needed). Stored encrypted.
 * - API key: an ANTHROPIC_API_KEY, stored encrypted.
 */
export default function AuthGate({
  hasExistingLogin,
  onAuthed
}: {
  hasExistingLogin: boolean
  onAuthed: () => void
}): JSX.Element {
  const [method, setMethod] = useState<Method>('subscription')

  return (
    <div className="gate">
      <div className="gate-card wide">
        <div className="brand big">
          <span className="brand-mark">⚒</span> CLAUDE FORGE
        </div>
        <p className="gate-lead">Connect the way you already use Claude.</p>

        <div className="methods">
          <button
            className={`method-card ${method === 'subscription' ? 'selected' : ''}`}
            onClick={() => setMethod('subscription')}
          >
            <div className="method-head">
              Claude subscription
              <span className="badge">RECOMMENDED</span>
            </div>
            <div className="method-desc">Pro / Max login — the same way the CLI works.</div>
          </button>

          <button
            className={`method-card ${method === 'api-key' ? 'selected' : ''}`}
            onClick={() => setMethod('api-key')}
          >
            <div className="method-head">API key</div>
            <div className="method-desc">Bring your own Anthropic API key (per-token billing).</div>
          </button>
        </div>

        {method === 'subscription' ? (
          <SubscriptionPanel hasExistingLogin={hasExistingLogin} onAuthed={onAuthed} />
        ) : (
          <ApiKeyPanel onAuthed={onAuthed} />
        )}

        <p className="gate-foot">
          Credentials stay on this machine (OS keystore for stored secrets; subscription reuses your
          existing login). Nothing is sent anywhere but Anthropic.
        </p>
      </div>
    </div>
  )
}

function SubscriptionPanel({
  hasExistingLogin,
  onAuthed
}: {
  hasExistingLogin: boolean
  onAuthed: () => void
}): JSX.Element {
  const [showToken, setShowToken] = useState(!hasExistingLogin)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function useExisting(): Promise<void> {
    setError(null)
    setBusy(true)
    try {
      await window.forge.auth.useSubscription()
      onAuthed()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveToken(): Promise<void> {
    if (!token.trim() || busy) return
    setError(null)
    setBusy(true)
    try {
      await window.forge.auth.useOAuthToken(token.trim())
      onAuthed()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      {hasExistingLogin ? (
        <div className="found">
          <div className="found-row">
            <span className="conn-dot" />
            <span>
              Found your Claude Code login on this machine. Use it — no setup needed.
            </span>
          </div>
          <button className="primary" disabled={busy} onClick={useExisting}>
            {busy ? 'connecting…' : 'Use my subscription'}
          </button>
        </div>
      ) : (
        <div className="hint">
          No existing Claude login found on this machine. Either run{' '}
          <code>claude /login</code> once in a terminal, or paste a token from{' '}
          <code>claude setup-token</code> below.
        </div>
      )}

      <button className="subtle-toggle" onClick={() => setShowToken((v) => !v)}>
        {showToken ? '▾' : '▸'} Advanced — paste a setup-token
      </button>

      {showToken && (
        <div className="token-row">
          <label className="field-label" htmlFor="token">
            CLAUDE_CODE_OAUTH_TOKEN (from <code>claude setup-token</code>)
          </label>
          <input
            id="token"
            type="password"
            className="field"
            placeholder="sk-ant-oat…"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveToken()
            }}
          />
          <button className="primary ghost-primary" disabled={!token.trim() || busy} onClick={saveToken}>
            {busy ? 'storing…' : 'Save token'}
          </button>
        </div>
      )}

      {error && <div className="gate-error">{error}</div>}
    </div>
  )
}

function ApiKeyPanel({ onAuthed }: { onAuthed: () => void }): JSX.Element {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = key.trim()
  const looksValid = trimmed.startsWith('sk-ant-') && trimmed.length > 20

  async function save(): Promise<void> {
    if (!looksValid || busy) return
    setError(null)
    setBusy(true)
    try {
      await window.forge.auth.useApiKey(trimmed)
      onAuthed()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <label className="field-label" htmlFor="apikey">
        ANTHROPIC API KEY
      </label>
      <input
        id="apikey"
        type="password"
        className="field"
        placeholder="sk-ant-…"
        spellCheck={false}
        autoFocus
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
        }}
      />
      {error && <div className="gate-error">{error}</div>}
      <button className="primary" disabled={!looksValid || busy} onClick={save}>
        {busy ? 'storing…' : 'Use API key'}
      </button>
    </div>
  )
}
