// The chat work-header: the model/permission/effort/persona/route status line +
// the export / find / context-gauge / compact controls. Extracted from
// Composer.tsx (behavior-preserving) — presentational; state comes via props
// (the search + compaction hook objects are passed whole to keep props lean).
import type { JSX } from 'react'
import type { Effort, Permission } from '../../types'
import { ctxWindow } from '../../lib/format'
import type { TranscriptSearch } from './useTranscriptSearch'
import type { Compaction } from './useCompaction'

export default function WorkHeader({
  model,
  permission,
  effort,
  costSaver,
  convPersona,
  routePreview,
  promptHasText,
  hasTurns,
  hasHistory,
  exportOpen,
  setExportOpen,
  doExport,
  search,
  contextTokens,
  ctxPct,
  contextModel,
  compaction,
  sessionId,
  running
}: {
  model?: string
  permission: Permission
  effort?: Effort
  costSaver: boolean
  convPersona?: string
  routePreview: { model: string; difficulty: string } | null
  promptHasText: boolean
  hasTurns: boolean
  hasHistory: boolean
  exportOpen: boolean
  setExportOpen: React.Dispatch<React.SetStateAction<boolean>>
  doExport: (fmt: 'md' | 'json') => void
  search: TranscriptSearch
  contextTokens: number
  ctxPct: number
  contextModel: string
  compaction: Compaction
  sessionId: string | null
  running: boolean
}): JSX.Element {
  const { searchOpen, setSearchOpen, setSearch, searchRef } = search
  const { compacting, compactPct, compact } = compaction
  return (
    <div className="work-header">
      <div className="wh-left">
        <span className="wh-item">
          <span className="brand-mark">⚒</span> {costSaver ? 'cost-saver' : model ?? 'default'}
        </span>
        <span className="wh-sep">·</span>
        <span className="wh-item">{permission}</span>
        <span className="wh-sep">·</span>
        <span className="wh-item">effort {costSaver ? 'auto' : effort ?? 'auto'}</span>
        {convPersona && (
          <>
            <span className="wh-sep">·</span>
            <span className="wh-item route-preview" title={convPersona}>
              ✦ persona
            </span>
          </>
        )}
        {routePreview && promptHasText && (
          <>
            <span className="wh-sep">·</span>
            <span
              className="wh-item route-preview"
              title="Cost-saver routes this task to the cheapest tier that fits its difficulty"
            >
              → {routePreview.model} ({routePreview.difficulty})
            </span>
          </>
        )}
      </div>
      <div className="wh-right">
        {(hasTurns || hasHistory) && (
          <div className="export-wrap">
            <button
              className={`mini-btn${exportOpen ? ' on' : ''}`}
              title="Export this conversation"
              onClick={() => setExportOpen((v) => !v)}
            >
              ⭳ export
            </button>
            {exportOpen && (
              <div className="export-menu" onMouseLeave={() => setExportOpen(false)}>
                <button className="export-item" onClick={() => doExport('md')}>
                  Markdown (.md)
                </button>
                <button className="export-item" onClick={() => doExport('json')}>
                  JSON (.json)
                </button>
              </div>
            )}
          </div>
        )}
        {hasTurns && (
          <button
            className={`mini-btn${searchOpen ? ' on' : ''}`}
            title="Search this conversation (Ctrl/Cmd+F)"
            onClick={() => {
              const next = !searchOpen
              setSearchOpen(next)
              if (next) requestAnimationFrame(() => searchRef.current?.focus())
              else setSearch('')
            }}
          >
            ⌕ find
          </button>
        )}
        {contextTokens > 0 && (
          <div
            className={`ctx-gauge ${ctxPct >= 70 ? 'hot' : ''}`}
            title={`${contextTokens.toLocaleString()} context tokens of ${ctxWindow(contextModel).toLocaleString()}`}
          >
            ctx {ctxPct}%
            <div className="ctx-bar">
              <div className="ctx-fill" style={{ width: ctxPct + '%' }} />
            </div>
          </div>
        )}
        {compacting || compactPct > 0 ? (
          <div
            className="compact-progress"
            title={`Compacting context… ${compactPct}%`}
            role="progressbar"
            aria-valuenow={compactPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className="compact-progress-label">⟲ compacting… {compactPct}%</span>
            <div className="compact-bar">
              <div className="compact-fill" style={{ width: compactPct + '%' }} />
            </div>
          </div>
        ) : (
          sessionId && (
            <button
              className="mini-btn"
              onClick={compact}
              disabled={running}
              title="Summarize older context to free tokens"
            >
              ⟲ compact
            </button>
          )
        )}
      </div>
    </div>
  )
}
