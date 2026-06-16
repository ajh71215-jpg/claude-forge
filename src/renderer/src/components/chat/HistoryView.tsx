// Read-only render of a restored past-conversation transcript
// (docs/MAINTAINABILITY.md Phase 2). Extracted verbatim from App.tsx —
// behavior-preserving.
import type { JSX } from 'react'
import type { TranscriptItem } from '../../types'
import { toolArgObj, toolIcon } from '../../lib/format'
import { parseTodos } from '../../lib/blocks'
import Md from '../Md'
import TodoList from './TodoList'

/** Render a restored past-conversation transcript (read-only). */
export default function HistoryView({ items }: { items: TranscriptItem[] }): JSX.Element | null {
  if (!items.length) return null
  return (
    <div className="history">
      {items.map((it, i) => {
        if (it.kind === 'user') {
          return (
            <div key={i} className="user-msg">
              {it.text}
            </div>
          )
        }
        if (it.kind === 'text') {
          return (
            <div key={i} className="response">
              <Md>{it.text}</Md>
            </div>
          )
        }
        if (it.kind === 'thinking') {
          return (
            <div key={i} className="thinking">
              <div className="thinking-head">THINKING</div>
              <pre className="thinking-text">{it.text}</pre>
            </div>
          )
        }
        if (it.name === 'TodoWrite') {
          const todos = parseTodos(it.input)
          if (todos && todos.length) return <TodoList key={i} todos={todos} />
        }
        const arg = toolArgObj(it.input)
        const badge = it.status === 'error' ? 'ERR' : 'OK'
        const result =
          it.result && it.result.length > 700 ? it.result.slice(0, 700) + '…' : it.result
        return (
          <div key={i} className={`tool-card ${it.status}`}>
            <div className="tool-row">
              <span className="tool-icon">{toolIcon(it.name)}</span>
              <span className="tool-name">{it.name}</span>
              <span className="tool-arg">{arg}</span>
              <span className={`tool-badge ${it.status}`}>{badge}</span>
            </div>
            {result && <pre className="tool-result">{result}</pre>}
          </div>
        )
      })}
      <div className="history-divider">— resumed · continue below —</div>
    </div>
  )
}
