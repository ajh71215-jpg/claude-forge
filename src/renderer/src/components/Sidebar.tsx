// The left-hand control rail, extracted from App.tsx's MainShell for readability
// (docs/MAINTAINABILITY.md). Behavior-preserving: the JSX is unchanged; the
// shell's state/handlers are now passed in as props instead of closed over.
import { useMemo, useState, type JSX } from 'react'
import Icon from './Icon'
import type {
  AuthMode,
  Capabilities,
  EffortLabel,
  McpServer,
  ModelInfo,
  Permission,
  Persona,
  SessionInfo,
  UsageInfo
} from '../types'
import { EFFORTS, PERMS } from '../lib/constants'
import {
  cacheHitPercent,
  defaultMaxTurns,
  fmtTokens,
  mcpStatusClass,
  methodLabel,
  usageShortLabel
} from '../lib/format'

/** Accumulated per-session token/cost usage shown in the sidebar. */
export interface SessionUsage {
  costUsd: number
  input: number
  output: number
  runs: number
  cacheRead: number
  cacheWrite: number
  promptTotal: number
}

export interface SidebarProps {
  mode: AuthMode
  caps: Capabilities | null
  models: ModelInfo[]
  mcpServers: McpServer[]
  model: string
  permission: Permission
  effort: EffortLabel
  costSaver: boolean
  modelEfforts: string[] | undefined
  effortSupported: (label: EffortLabel) => boolean
  maxTurns: number
  maxTurnsByModel: Record<string, number>
  maxBudget: number
  autoCompact: boolean
  subUsage: UsageInfo | null
  usageLoading: boolean
  usage: SessionUsage
  sessions: SessionInfo[]
  sessionId: string | null
  persona: Persona | null
  onChooseModel: (v: string) => void
  onChooseEffort: (l: EffortLabel) => void
  onSetPermission: (p: Permission) => void
  onSetCostSaver: (v: boolean) => void
  onSetMaxTurns: (n: number) => void
  onResetMaxTurns: () => void
  onSetMaxBudget: (n: number) => void
  onSetAutoCompact: (v: boolean) => void
  onRefreshUsage: () => void
  onNewSession: () => void
  onResumeSession: (id: string) => void
  /** Pinned conversation ids (sorted first). */
  pinned: Set<string>
  onTogglePin: (id: string) => void
  onRenameSession: (id: string, title: string) => void
  onDeleteSession: (id: string) => void
  onSearchAll: () => void
  onShowPersona: () => void
  onOpenSettings: () => void
  onDisconnect: () => void
}

export default function Sidebar(props: SidebarProps): JSX.Element {
  const {
    mode,
    caps,
    models,
    mcpServers,
    model,
    permission,
    effort,
    costSaver,
    modelEfforts,
    effortSupported,
    maxTurns,
    maxTurnsByModel,
    maxBudget,
    autoCompact,
    subUsage,
    usageLoading,
    usage,
    sessions,
    sessionId,
    persona,
    onChooseModel,
    onChooseEffort,
    onSetPermission,
    onSetCostSaver,
    onSetMaxTurns,
    onResetMaxTurns,
    onSetMaxBudget,
    onSetAutoCompact,
    onRefreshUsage,
    onNewSession,
    onResumeSession,
    pinned,
    onTogglePin,
    onRenameSession,
    onDeleteSession,
    onSearchAll,
    onShowPersona,
    onOpenSettings,
    onDisconnect
  } = props
  const cacheHitPct = cacheHitPercent(usage.input, usage.cacheRead, usage.cacheWrite) ?? 0
  // Inline rename state for the conversations list.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  function startRename(id: string, current: string): void {
    setRenamingId(id)
    setRenameText(current)
  }
  function submitRename(): void {
    if (renamingId) onRenameSession(renamingId, renameText)
    setRenamingId(null)
  }
  // Pinned conversations sort to the top; otherwise preserve recency order.
  const sortedSessions = useMemo(
    () =>
      [...sessions].sort(
        (a, b) => (pinned.has(b.sessionId) ? 1 : 0) - (pinned.has(a.sessionId) ? 1 : 0)
      ),
    [sessions, pinned]
  )

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">⚒</span> FORGE
        <button className="brand-settings" title="Settings" onClick={onOpenSettings}>
          ⚙
        </button>
      </div>

      <div className="conn">
        <div className="conn-dot" />
        <div>
          <div className="conn-label">CONNECTED</div>
          <div className="conn-method">{methodLabel(mode)}</div>
        </div>
      </div>

      <label className={`saver-toggle ${costSaver ? 'on' : ''}`}>
        <input type="checkbox" checked={costSaver} onChange={(e) => onSetCostSaver(e.target.checked)} />
        <div>
          <div className="saver-title">
            <Icon name="bolt" className="saver-icon" /> COST-SAVER
          </div>
          <div className="saver-desc">Auto-route each task by difficulty</div>
        </div>
      </label>

      <div className={`selector ${costSaver ? 'dim' : ''}`}>
        <div className="selector-label">MODEL</div>
        <div className="model-list">
          {caps === null && <div className="selector-hint">loading models…</div>}
          {caps && models.length === 0 && <div className="selector-hint">no models available</div>}
          {model && models.length > 0 && !models.some((m) => m.value === model) && (
            <button className="model-card on" onClick={() => onChooseModel(model)}>
              <div className="model-name">{model}</div>
              <div className="model-desc">custom model id (via /model)</div>
            </button>
          )}
          {models.map((m) => (
            <button
              key={m.value}
              className={`model-card ${!costSaver && model === m.value ? 'on' : ''}`}
              onClick={() => onChooseModel(m.value)}
            >
              <div className="model-name">{m.displayName}</div>
              {m.description && <div className="model-desc">{m.description}</div>}
            </button>
          ))}
        </div>
        {costSaver && (
          <div className="selector-hint">auto-routed per task → haiku · sonnet · opus</div>
        )}
      </div>

      <div className={`selector ${costSaver ? 'dim' : ''}`}>
        <div className="selector-label">EFFORT</div>
        <div className="effort-grid">
          {EFFORTS.map((e) => {
            const ok = effortSupported(e)
            return (
              <button
                key={e}
                className={`effort-cell ${!costSaver && effort === e ? 'on' : ''}`}
                disabled={!ok}
                title={ok ? undefined : `${model} has no separate effort control`}
                onClick={() => onChooseEffort(e)}
              >
                {e}
              </button>
            )
          })}
        </div>
        {costSaver ? (
          <div className="selector-hint">auto-routed per task difficulty</div>
        ) : modelEfforts && modelEfforts.length === 0 ? (
          <div className="selector-hint">{model} runs at a fixed effort</div>
        ) : (
          (effort === 'XHIGH' || effort === 'MAX') && <div className="effort-warn">⚠ high token use</div>
        )}
      </div>

      <div className="selector">
        <div className="selector-label">LIMITS</div>
        <div className="limit-row">
          <label htmlFor="maxturns">max turns</label>
          <input
            id="maxturns"
            type="number"
            min={1}
            max={200}
            value={maxTurns}
            onChange={(e) => onSetMaxTurns(Number(e.target.value) || 1)}
          />
        </div>
        <div className="selector-hint">
          per <b>{model}</b> · default {defaultMaxTurns(model)}
          {maxTurnsByModel[model] !== undefined && (
            <button type="button" className="link-reset" onClick={onResetMaxTurns}>
              reset
            </button>
          )}
        </div>
        <div className="limit-row">
          <label htmlFor="maxbudget">max $ / run</label>
          <input
            id="maxbudget"
            type="number"
            min={0}
            step={0.5}
            placeholder="off"
            value={maxBudget || ''}
            onChange={(e) => onSetMaxBudget(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        <label className="limit-check">
          <input
            type="checkbox"
            checked={autoCompact}
            onChange={(e) => onSetAutoCompact(e.target.checked)}
          />
          auto-compact at 80% context
        </label>
      </div>

      <div className="selector">
        <div className="selector-label">PERMISSIONS</div>
        <div className="perm-list">
          {PERMS.map((p) => (
            <button
              key={p.id}
              className={`perm-card ${permission === p.id ? 'on' : ''}`}
              onClick={() => onSetPermission(p.id)}
            >
              <div className="perm-title">{p.title}</div>
              <div className="perm-desc">{p.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="selector">
        <div className="selector-head">
          <div className="selector-label">AGENT</div>
          <button className="mini-btn" onClick={onShowPersona}>
            ✎ Customize
          </button>
        </div>
        <button className="persona-card" onClick={onShowPersona}>
          <div className="persona-row">
            <span className={`persona-dot ${persona?.enabled && persona.text.trim() ? 'on' : ''}`} />
            <span className="persona-state">
              {persona?.enabled && persona.text.trim() ? 'Custom behavior active' : 'Default behavior'}
            </span>
          </div>
          {persona?.enabled && persona.text.trim() ? (
            <div className="persona-preview">
              {persona.text.trim().slice(0, 90)}
              {persona.text.trim().length > 90 ? '…' : ''}
            </div>
          ) : (
            <div className="persona-preview muted">Click to give the agent custom instructions</div>
          )}
        </button>
      </div>

      <div className="selector">
        <div className="selector-label">MCP SERVERS</div>
        <div className="mcp-list">
          {caps === null && <div className="selector-hint">…</div>}
          {caps && mcpServers.length === 0 && <div className="selector-hint">none configured</div>}
          {mcpServers.map((s) => (
            <div className="mcp-row" key={s.name} title={s.url ?? ''}>
              <span className={`mcp-dot ${mcpStatusClass(s.status)}`} />
              <span className="mcp-name">{s.name.replace(/^claude\.ai /, '')}</span>
              <span className="mcp-status">{s.status}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="selector">
        <div className="selector-head">
          <div className="selector-label">CONVERSATIONS</div>
          <div className="conv-head-actions">
            <button className="mini-btn" title="Search all conversations" onClick={onSearchAll}>
              ⌕
            </button>
            <button className="mini-btn" onClick={onNewSession}>
              + New
            </button>
          </div>
        </div>
        <div className="conv-list">
          {sessions.length === 0 && <div className="selector-hint">no saved conversations</div>}
          {sortedSessions.slice(0, 15).map((s) => {
            const isPinned = pinned.has(s.sessionId)
            return (
              <div
                key={s.sessionId}
                className={`conv-row ${sessionId === s.sessionId ? 'on' : ''} ${isPinned ? 'pinned' : ''}`}
              >
                {renamingId === s.sessionId ? (
                  <input
                    className="conv-rename"
                    autoFocus
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onBlur={submitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename()
                      else if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                ) : (
                  <>
                    <button
                      className="conv-title"
                      title={s.firstPrompt ?? s.title}
                      onClick={() => onResumeSession(s.sessionId)}
                    >
                      {isPinned && <span className="conv-pin-dot" aria-hidden />}
                      {s.title}
                    </button>
                    <div className="conv-actions">
                      <button
                        className={`conv-act ${isPinned ? 'on' : ''}`}
                        title={isPinned ? 'Unpin' : 'Pin'}
                        onClick={() => onTogglePin(s.sessionId)}
                      >
                        {isPinned ? '★' : '☆'}
                      </button>
                      <button
                        className="conv-act"
                        title="Rename"
                        onClick={() => startRename(s.sessionId, s.title)}
                      >
                        ✎
                      </button>
                      <button
                        className="conv-act"
                        title="Delete"
                        onClick={() => onDeleteSession(s.sessionId)}
                      >
                        ✕
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="selector session">
        <div className="selector-head">
          <div className="selector-label">PLAN USAGE</div>
          <div className="usage-head-right">
            {caps?.account?.subscriptionType && (
              <span className="plan-badge">{caps.account.subscriptionType}</span>
            )}
            <button
              className={`mini-btn${usageLoading ? ' spinning' : ''}`}
              title="Refresh usage"
              onClick={onRefreshUsage}
              disabled={usageLoading}
            >
              ↻
            </button>
          </div>
        </div>
        {/* Never show an error/unavailable state. Before the first successful
            refresh there's simply no data — a neutral hint invites a manual ↻. */}
        {(!subUsage || subUsage.entries.length === 0) && (
          <div className="selector-hint">{usageLoading ? 'updating…' : 'press ↻ to update'}</div>
        )}
        {subUsage?.entries.map((e) => (
          <div className="usage-entry" key={e.label}>
            <div className="usage-top">
              <span className="usage-label">{usageShortLabel(e.label)}</span>
              <span className="usage-pct">{e.percent}%</span>
            </div>
            <div className="usage-bar">
              <div
                className={`usage-fill ${e.percent >= 80 ? 'hot' : ''}`}
                style={{ width: `${Math.min(100, e.percent)}%` }}
              />
            </div>
            <div className="usage-reset">resets {e.resets}</div>
          </div>
        ))}
      </div>

      <div className="selector">
        <div className="selector-label">TOKENS · THIS SESSION</div>
        <div className="tok-grid">
          <div className="tok-cell">
            <div className="tok-num">{fmtTokens(usage.input)}</div>
            <div className="tok-lbl">fresh in</div>
          </div>
          <div className="tok-cell">
            <div className="tok-num">{fmtTokens(usage.output)}</div>
            <div className="tok-lbl">out</div>
          </div>
        </div>
        <div className="usage-entry tok-cache">
          <div className="usage-top">
            <span className="usage-label">cache reuse</span>
            <span className="usage-pct">{cacheHitPct}%</span>
          </div>
          <div className="usage-bar">
            <div className="usage-fill" style={{ width: cacheHitPct + '%' }} />
          </div>
          <div className="usage-reset">
            {fmtTokens(usage.cacheRead)} read · {fmtTokens(usage.cacheWrite)} written of{' '}
            {fmtTokens(usage.promptTotal)} input tokens
          </div>
        </div>
        <div className="session-meta local-cost">
          ${usage.costUsd.toFixed(4)} · {usage.runs} run{usage.runs === 1 ? '' : 's'}
        </div>
      </div>

      <button className="ghost" onClick={onDisconnect}>
        Disconnect
      </button>
    </aside>
  )
}
