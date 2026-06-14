// TodoWrite checklist (docs/MAINTAINABILITY.md Phase 2). Shared by the live
// transcript (BlockView) and restored history (HistoryView). Extracted verbatim
// from App.tsx — behavior-preserving.
import type { JSX } from 'react'
import type { Todo } from '../../types'

/** Render a TodoWrite list as a live checklist (shared by live + history views). */
export default function TodoList({ todos }: { todos: Todo[] }): JSX.Element {
  const done = todos.filter((t) => t.status === 'completed').length
  return (
    <div className="todo-card">
      <div className="todo-head">
        <span className="tool-icon">☑</span>
        <span className="tool-name">TASKS</span>
        <span className="todo-count">
          {done}/{todos.length}
        </span>
      </div>
      <ul className="todo-list">
        {todos.map((t, i) => (
          <li key={i} className={`todo-item ${t.status}`}>
            <span className="todo-check">
              {t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'}
            </span>
            <span className="todo-text">
              {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
