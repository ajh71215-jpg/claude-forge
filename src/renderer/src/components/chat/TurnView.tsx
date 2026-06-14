// One user→assistant exchange in the live transcript (docs/MAINTAINABILITY.md
// Phase 2). Extracted verbatim from App.tsx — behavior-preserving. Memoization
// is docs/PERFORMANCE.md lever 3 (do not change without re-profiling).
import { memo, type JSX } from 'react'
import type { Block, Turn } from '../../types'
import BlockView from './BlockView'

/** One user→assistant exchange in the live transcript. */
// Memoized: completed turns keep a stable `turn` ref and stable callbacks, so a
// streaming flush only re-renders the active turn. docs/PERFORMANCE.md lever 3.
const TurnView = memo(function TurnView({
  turn,
  onRetry,
  onEdit
}: {
  turn: Turn
  onRetry: (prompt: string) => void
  onEdit: (prompt: string) => void
}): JSX.Element {
  const lastIdx = turn.blocks.length - 1
  function copy(): void {
    const text = turn.blocks
      .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n\n')
    if (text) navigator.clipboard?.writeText(text)
  }
  return (
    <div className="turn">
      <div className="user-msg">
        {turn.previews.length > 0 && (
          <div className="user-imgs">
            {turn.previews.map((p, i) => (
              <img key={i} src={p} alt="" />
            ))}
          </div>
        )}
        {turn.prompt}
      </div>
      {turn.blocks.map((b, i) => (
        <BlockView key={b.id} block={b} streaming={turn.running && i === lastIdx} />
      ))}
      {turn.running && turn.blocks.length === 0 && <div className="muted small">forging…</div>}
      {turn.meta?.error && (
        <div className="response response-error">
          <pre className="response-text">⚠ {turn.meta.error}</pre>
        </div>
      )}
      {turn.meta && !turn.meta.error && !turn.running && (
        <div className="response-footer">
          <div className="response-meta standalone">
            {typeof turn.meta.costUsd === 'number' && <span>${turn.meta.costUsd.toFixed(4)}</span>}
            {typeof turn.meta.durationMs === 'number' && (
              <span>{(turn.meta.durationMs / 1000).toFixed(1)}s</span>
            )}
          </div>
          <div className="msg-actions">
            <button className="msg-act" onClick={copy} title="Copy response">
              ⧉ copy
            </button>
            <button
              className="msg-act"
              onClick={() => onRetry(turn.prompt)}
              title="Retry same prompt"
            >
              ↻ retry
            </button>
            <button className="msg-act" onClick={() => onEdit(turn.prompt)} title="Edit & resend">
              ✎ edit
            </button>
          </div>
        </div>
      )}
    </div>
  )
})

export default TurnView
