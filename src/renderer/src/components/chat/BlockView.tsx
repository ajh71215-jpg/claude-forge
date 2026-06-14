// One streaming block (text / thinking / tool) in the live transcript
// (docs/MAINTAINABILITY.md Phase 2). Extracted verbatim from App.tsx —
// behavior-preserving. Memoization + plain/markdown streaming split are
// docs/PERFORMANCE.md levers 1 & 3 (do not change without re-profiling).
import { memo, type JSX } from 'react'
import type { Block } from '../../types'
import { toolArg, toolIcon } from '../../lib/format'
import { parseTodos } from '../../lib/blocks'
import Md from '../Md'
import TodoList from './TodoList'

// Memoized: a completed block keeps a stable `block` ref + streaming=false, so it
// skips re-render on every streaming flush. docs/PERFORMANCE.md lever 3.
const BlockView = memo(function BlockView({
  block,
  streaming
}: {
  block: Block
  streaming: boolean
}): JSX.Element | null {
  if (block.kind === 'text') {
    if (!block.text && !streaming) return null
    return (
      <div className="response">
        {/* While streaming, render plain text (O(n) appends). Parse markdown once
            on completion — re-parsing the growing string every delta is O(n²)
            because react-markdown has no incremental parse. docs/PERFORMANCE.md
            lever 1. */}
        {streaming ? (
          <pre className="response-text-stream">{block.text}</pre>
        ) : (
          <Md>{block.text}</Md>
        )}
        {streaming && <span className="caret">▍</span>}
      </div>
    )
  }
  if (block.kind === 'thinking') {
    if (!block.text && !streaming) return null
    return (
      <div className="thinking">
        <div className="thinking-head">THINKING</div>
        <pre className="thinking-text">
          {block.text}
          {streaming && <span className="caret">▍</span>}
        </pre>
      </div>
    )
  }
  // TodoWrite renders as a checklist rather than a generic tool card.
  if (block.name === 'TodoWrite') {
    const todos = parseTodos(block.inputRaw)
    if (todos && todos.length) return <TodoList todos={todos} />
    return (
      <div className="todo-card">
        <div className="todo-head">
          <span className="tool-icon">☑</span>
          <span className="tool-name">TASKS</span>
        </div>
        <div className="muted small">updating…</div>
      </div>
    )
  }
  const arg = toolArg(block.inputRaw)
  const badge = block.status === 'ok' ? 'OK' : block.status === 'error' ? 'ERR' : 'RUNNING'
  const result =
    block.result && block.result.length > 700 ? block.result.slice(0, 700) + '…' : block.result
  return (
    <div className={`tool-card ${block.status}`}>
      <div className="tool-row">
        <span className="tool-icon">{toolIcon(block.name)}</span>
        <span className="tool-name">{block.name}</span>
        <span className="tool-arg">{arg}</span>
        <span className={`tool-badge ${block.status}`}>{badge}</span>
      </div>
      {result && block.status !== 'running' && <pre className="tool-result">{result}</pre>}
    </div>
  )
})

export default BlockView
