// DebugSidePanel - slim real-time debug monitor anchored to the right of the
// chat area. Shows the current run's thinking + tool calls as they stream in.
// Zero extra tokens: subscribes to the existing agent:event IPC channel via
// useDebugStream. Opened/closed with the inspect button in the chat tab bar.
// Full details (tool I/O JSON) live in the Squad tab's RunDebugView; this panel
// is intentionally compact for monitoring while chatting.
//
// Design: follows docs/DESIGN.md - line icons via Icon.tsx (no multicolor emoji),
// tabular-nums for live numbers, status by dot + token-colored text.
import { useState, type JSX } from 'react'
import Icon from '../Icon'
import type { DebugRun, DebugEntry } from '../../lib/useDebugStream'

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s`
}

function prettyJsonSlice(raw: string, cap = 300): string {
  if (!raw.trim()) return ''
  try {
    const formatted = JSON.stringify(JSON.parse(raw), null, 2)
    return formatted.length > cap ? formatted.slice(0, cap) + '\n…' : formatted
  } catch {
    return raw.length > cap ? raw.slice(0, cap) + '…' : raw
  }
}

// ── Mini entry rows (compact for the slim panel) ─────────────────────────────

function MiniThinking({ entry }: { entry: DebugEntry }): JSX.Element {
  const [open, setOpen] = useState(false)
  const dur = entry.endedAt ? fmtMs(entry.endedAt - entry.startedAt) : null

  return (
    <div className={`dsp-entry thinking ${entry.status}`} onClick={() => setOpen((v) => !v)}>
      <div className="dsp-entry-row">
        {entry.status === 'running'
          ? <span className="ad-spinner dsp-spin" aria-hidden />
          : <span className="dsp-icon think"><Icon name="thinking" /></span>}
        <span className="dsp-label">thinking</span>
        <span className="dsp-spacer" />
        {dur && <span className="dsp-dur">{dur}</span>}
        {entry.text.length > 0 && <span className="dsp-chev">{open ? '▾' : '▸'}</span>}
      </div>
      {open && (
        <pre className="dsp-expand-text">{entry.text.length > 600 ? entry.text.slice(0, 600) + '\n…' : entry.text}</pre>
      )}
    </div>
  )
}

function MiniTool({ entry }: { entry: DebugEntry }): JSX.Element {
  const [open, setOpen] = useState(false)
  const dur = entry.endedAt ? fmtMs(entry.endedAt - entry.startedAt) : null

  return (
    <div className={`dsp-entry tool ${entry.status}`} onClick={() => setOpen((v) => !v)}>
      <div className="dsp-entry-row">
        <span className={`dsp-dot ${entry.status}`} />
        <span className="dsp-tool-name">{entry.name ?? 'tool'}</span>
        {entry.parentToolId && <span className="dsp-sub-mark" title="subagent tool">sub</span>}
        <span className="dsp-spacer" />
        {dur && <span className="dsp-dur">{dur}</span>}
        <span className="dsp-chev">{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className="dsp-tool-detail">
          {entry.inputJson && (
            <pre className="dsp-code">{prettyJsonSlice(entry.inputJson)}</pre>
          )}
          {entry.resultText != null && (
            <pre className={`dsp-code result ${entry.resultOk ? 'ok' : 'err'}`}>
              {prettyJsonSlice(entry.resultText, 400)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ── Run selector ──────────────────────────────────────────────────────────────

interface RunTabProps {
  runs: Map<string, DebugRun>
  selectedId: string | null
  onSelect: (id: string) => void
}

function RunSelector({ runs, selectedId, onSelect }: RunTabProps): JSX.Element | null {
  const all = [...runs.values()].reverse().slice(0, 5) // newest first, show last 5
  if (all.length <= 1) return null

  return (
    <div className="dsp-run-tabs">
      {all.map((r) => (
        <button
          key={r.runId}
          className={`dsp-run-tab ${r.runId === selectedId ? 'on' : ''} ${r.isLive ? 'live' : ''}`}
          onClick={() => onSelect(r.runId)}
          title={r.runId}
        >
          {r.isLive && <span className="dsp-live-dot" />}
          {r.runId.slice(-6)}
        </button>
      ))}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  runs: Map<string, DebugRun>
  currentRunId: string | null
  onClose: () => void
}

export default function DebugSidePanel({ runs, currentRunId, onClose }: Props): JSX.Element {
  // Allow the user to pin a specific run; default to the current/latest.
  const [pinnedRunId, setPinnedRunId] = useState<string | null>(null)
  const effectiveId = pinnedRunId ?? currentRunId
  const run: DebugRun | null = (effectiveId ? runs.get(effectiveId) : null) ?? null

  const thinkCount = run ? run.entries.filter((e) => e.kind === 'thinking').length : 0
  const toolCount = run ? run.entries.filter((e) => e.kind === 'tool').length : 0
  const elapsed = run ? (run.totalMs ?? (Date.now() - run.startedAt)) : 0

  return (
    <div className="dsp-root">
      {/* ── Header ── */}
      <div className="dsp-bar">
        <div className="dsp-bar-left">
          {run?.isLive && <span className="dsp-live-dot" />}
          <span className="dsp-title">Debug</span>
          {run && (
            <span className="dsp-counts">
              {thinkCount > 0 && (
                <span className="dsp-count"><Icon name="thinking" className="dsp-count-ico" />{thinkCount}</span>
              )}
              {toolCount > 0 && (
                <span className="dsp-count"><Icon name="tool" className="dsp-count-ico" />{toolCount}</span>
              )}
            </span>
          )}
        </div>
        <button className="dsp-close-btn" onClick={onClose} title="Close debug panel" aria-label="Close debug panel">
          ×
        </button>
      </div>

      {/* ── Run meta ── */}
      {run && (
        <div className="dsp-run-meta">
          <span className="dsp-runid" title={run.runId}>{run.runId.slice(-12)}</span>
          <span className="dsp-elapsed">{fmtMs(elapsed)}</span>
          {run.costUsd != null && run.costUsd > 0 && (
            <span className="dsp-cost">${run.costUsd.toFixed(4)}</span>
          )}
          {run.error && <span className="dsp-err-chip">error</span>}
        </div>
      )}

      {/* ── Run selector (when multiple runs exist) ── */}
      <RunSelector
        runs={runs}
        selectedId={effectiveId}
        onSelect={(id) => setPinnedRunId(id)}
      />

      {/* ── Event list ── */}
      <div className="dsp-entries-scroll">
        {!run ? (
          <div className="dsp-no-run">
            <div className="dsp-no-run-icon"><Icon name="inspect" /></div>
            <div className="dsp-no-run-text">
              Start a conversation to see live debug info. Thinking blocks and tool calls appear here as they stream in.
            </div>
          </div>
        ) : run.entries.filter((e) => e.kind !== 'text').length === 0 ? (
          <div className="dsp-no-run">
            <div className="dsp-no-run-text">
              {run.isLive ? 'Waiting for events…' : 'No debug events captured for this run.'}
            </div>
          </div>
        ) : (
          <div className="dsp-entries-list">
            {run.entries
              .filter((e) => e.kind !== 'text') // omit plain text blocks (visible in chat)
              .map((e, i) =>
                e.kind === 'thinking'
                  ? <MiniThinking key={`${e.blockId}-${i}`} entry={e} />
                  : <MiniTool key={`${e.blockId}-${i}`} entry={e} />
              )}
            {run.isLive && (
              <div className="dsp-live-tail">
                <span className="ad-spinner dsp-tail-spin" aria-hidden />
                <span>live</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer hint ── */}
      <div className="dsp-footer">
        Full I/O in the <strong>Agents</strong> tab, via Inspect.
      </div>
    </div>
  )
}
