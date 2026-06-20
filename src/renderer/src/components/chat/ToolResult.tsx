// Collapsible tool-result block. By default only the first line of a tool's
// output is shown (most tool results are long and noisy); the user clicks the
// header to expand the full output. Rendered in both the live transcript
// (BlockView) and restored history (HistoryView). Font is the mono stack
// (JetBrains Mono) via the .tool-result class.
import { useState, type JSX } from 'react'

export default function ToolResult({ text }: { text: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  // Normalize trailing newline so the "+N lines" count isn't off by a blank.
  const trimmed = text.replace(/\n+$/, '')
  const lines = trimmed.split('\n')
  const firstLine = lines[0]
  const hiddenCount = lines.length - 1
  const collapsible = hiddenCount > 0

  // Single-line result: nothing to collapse, render as-is.
  if (!collapsible) {
    return <pre className="tool-result">{trimmed}</pre>
  }

  return (
    <div className={`tool-result-block ${expanded ? 'expanded' : 'collapsed'}`}>
      <pre className="tool-result">{expanded ? trimmed : firstLine}</pre>
      <button
        type="button"
        className="tool-result-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={expanded ? 'Collapse output' : 'Expand output'}
      >
        <span className="tool-result-caret" aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
        <span className="tool-result-hint">
          {expanded ? 'collapse' : `+${hiddenCount} more line${hiddenCount === 1 ? '' : 's'}`}
        </span>
      </button>
    </div>
  )
}
