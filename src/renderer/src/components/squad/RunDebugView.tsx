// RunDebugView - full-panel debug view for a single agent run.
// Shown in the Squad (Agents) tab when the user clicks Inspect on a live card.
// Displays every streaming event in order: thinking blocks (with expandable full
// text), tool calls (with input JSON + output), and text response blocks. Uses
// data from useDebugStream - zero extra tokens.
//
// Design: follows docs/DESIGN.md - line icons via Icon.tsx (no multicolor emoji),
// 2px accent rails for nested content (§4), tabular-nums for live numbers,
// status by dot + text (never color alone).
import { useState, type JSX } from 'react'
import Icon from '../Icon'
import type { DebugRun, DebugEntry } from '../../lib/useDebugStream'

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s`
}

/** Best-effort pretty-print JSON; falls back to raw string on parse error. */
function prettyJson(raw: string): string {
  if (!raw.trim()) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

const RESULT_CAP = 3000 // characters

// ── Individual entry rows ─────────────────────────────────────────────────────

function ThinkingRow({ entry }: { entry: DebugEntry }): JSX.Element {
  const [open, setOpen] = useState(false)
  const dur = entry.endedAt ? fmtMs(entry.endedAt - entry.startedAt) : null
  const preview = entry.text.slice(0, 80).replace(/\n/g, ' ')

  return (
    <div className={`dbg-row thinking ${entry.status}`}>
      <div className="dbg-row-head" onClick={() => setOpen((v) => !v)}>
        <span className="dbg-row-icon think"><Icon name="thinking" /></span>
        <span className="dbg-row-label">thinking</span>
        {entry.status === 'running' && <span className="ad-spinner dbg-spin" aria-hidden />}
        {!open && preview && (
          <span className="dbg-preview">{preview}{entry.text.length > 80 ? '…' : ''}</span>
        )}
        <span className="dbg-spacer" />
        {dur && <span className="dbg-dur">{dur}</span>}
        {entry.text.length > 0 && (
          <span className="dbg-chevron">{open ? '▾' : '▸'}</span>
        )}
      </div>
      {open && (
        <pre className="dbg-text-body thinking-text">{entry.text || '…'}</pre>
      )}
    </div>
  )
}

function TextRow({ entry }: { entry: DebugEntry }): JSX.Element {
  const [open, setOpen] = useState(false)
  const dur = entry.endedAt ? fmtMs(entry.endedAt - entry.startedAt) : null
  const preview = entry.text.slice(0, 80).replace(/\n/g, ' ')

  return (
    <div className={`dbg-row text ${entry.status}`}>
      <div className="dbg-row-head" onClick={() => setOpen((v) => !v)}>
        <span className="dbg-row-icon resp"><Icon name="chat" /></span>
        <span className="dbg-row-label">response</span>
        {entry.status === 'running' && <span className="ad-spinner dbg-spin" aria-hidden />}
        {!open && preview && (
          <span className="dbg-preview">{preview}{entry.text.length > 80 ? '…' : ''}</span>
        )}
        <span className="dbg-spacer" />
        {dur && <span className="dbg-dur">{dur}</span>}
        {entry.text.length > 0 && (
          <span className="dbg-chevron">{open ? '▾' : '▸'}</span>
        )}
      </div>
      {open && (
        <pre className="dbg-text-body">{entry.text}</pre>
      )}
    </div>
  )
}

function ToolRow({ entry }: { entry: DebugEntry }): JSX.Element {
  const [open, setOpen] = useState(false)
  const dur = entry.endedAt ? fmtMs(entry.endedAt - entry.startedAt) : null
  const inputFormatted = prettyJson(entry.inputJson)

  return (
    <div className={`dbg-row tool ${entry.status}`}>
      <div className="dbg-row-head" onClick={() => setOpen((v) => !v)}>
        <span className={`dbg-tool-dot ${entry.status}`} />
        <span className="dbg-row-icon tool-ico"><Icon name="tool" /></span>
        <span className="dbg-row-label tool-name">{entry.name ?? 'tool'}</span>
        {entry.status === 'running' && <span className="ad-spinner dbg-spin" aria-hidden />}
        {entry.parentToolId && <span className="dbg-badge sub">subagent</span>}
        <span className="dbg-spacer" />
        {dur && <span className="dbg-dur">{dur}</span>}
        <span className="dbg-chevron">{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className="dbg-tool-body">
          {inputFormatted && (
            <div className="dbg-io">
              <div className="dbg-io-label">input</div>
              <pre className="dbg-io-code">{inputFormatted}</pre>
            </div>
          )}
          {entry.resultText != null && (
            <div className="dbg-io">
              <div className={`dbg-io-label ${entry.resultOk ? 'ok' : 'err'}`}>
                {entry.resultOk ? 'output' : 'output (error)'}
              </div>
              <pre className="dbg-io-code">
                {entry.resultText.length > RESULT_CAP
                  ? entry.resultText.slice(0, RESULT_CAP) +
                    '\n\n… (truncated, ' +
                    (entry.resultText.length - RESULT_CAP) +
                    ' chars omitted)'
                  : entry.resultText}
              </pre>
            </div>
          )}
          {!inputFormatted && entry.resultText == null && (
            <div className="dbg-io-empty">No I/O captured yet…</div>
          )}
        </div>
      )}
    </div>
  )
}

function EntryRow({ entry }: { entry: DebugEntry }): JSX.Element {
  if (entry.kind === 'thinking') return <ThinkingRow entry={entry} />
  if (entry.kind === 'text') return <TextRow entry={entry} />
  return <ToolRow entry={entry} />
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  run: DebugRun | null
  onClose: () => void
}

export default function RunDebugView({ run, onClose }: Props): JSX.Element {
  if (!run) {
    return (
      <div className="dbg-view">
        <div className="dbg-view-bar">
          <span className="dbg-view-title">Debug Inspector</span>
          <button className="dbg-back-btn" onClick={onClose}>close</button>
        </div>
        <div className="dbg-empty-state">
          <div className="dbg-empty-icon"><Icon name="inspect" /></div>
          <div className="dbg-empty-msg">
            Run data not available. Start a new conversation to collect debug events.
          </div>
        </div>
      </div>
    )
  }

  const thinkCount = run.entries.filter((e) => e.kind === 'thinking').length
  const toolCount = run.entries.filter((e) => e.kind === 'tool').length
  const elapsed = run.totalMs ?? (Date.now() - run.startedAt)

  return (
    <div className="dbg-view">
      {/* ── Header bar ── */}
      <div className="dbg-view-bar">
        <div className="dbg-view-meta">
          {run.isLive && <span className="ad-live-dot" />}
          <span className="dbg-view-runid" title={run.runId}>{run.runId.slice(-12)}</span>
          <span className="dbg-view-stats">
            {thinkCount > 0 && (
              <span className="dbg-stat"><Icon name="thinking" className="dbg-stat-ico" /> {thinkCount}</span>
            )}
            {toolCount > 0 && (
              <span className="dbg-stat"><Icon name="tool" className="dbg-stat-ico" /> {toolCount}</span>
            )}
            <span className="dbg-stat-sep">·</span>
            <span>{fmtMs(elapsed)}</span>
            {run.costUsd != null && run.costUsd > 0 && (
              <>
                <span className="dbg-stat-sep">·</span>
                <span>${run.costUsd.toFixed(4)}</span>
              </>
            )}
            {run.error && (
              <>
                <span className="dbg-stat-sep">·</span>
                <span className="dbg-error-badge">error</span>
              </>
            )}
          </span>
        </div>
        <button className="dbg-back-btn" onClick={onClose}>back to agents</button>
      </div>

      {/* ── Entry list ── */}
      <div className="dbg-entries-scroll">
        {run.entries.length === 0 ? (
          <div className="dbg-empty-state">
            <div className="dbg-empty-icon"><Icon name="inspect" /></div>
            <div className="dbg-empty-msg">
              {run.isLive ? 'Waiting for agent events…' : 'No events were captured for this run.'}
            </div>
          </div>
        ) : (
          <div className="dbg-entries-list">
            {run.entries.map((e, i) => (
              <EntryRow key={`${e.blockId}-${i}`} entry={e} />
            ))}
            {run.isLive && (
              <div className="dbg-live-tail">
                <span className="ad-spinner" aria-hidden /> listening for events…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
