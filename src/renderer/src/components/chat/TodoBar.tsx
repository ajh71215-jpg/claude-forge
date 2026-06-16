// Pinned task-progress bar shown above the composer (docs/MAINTAINABILITY.md
// Phase 2). Extracted verbatim from App.tsx — behavior-preserving.
import { useState, type JSX } from 'react'
import type { Todo } from '../../types'

/** Pinned, collapsible task progress bar (shown above the composer). */
export default function TodoBar({ todos }: { todos: Todo[] }): JSX.Element {
  const [open, setOpen] = useState(true)
  const done = todos.filter((t) => t.status === 'completed').length
  const current = todos.find((t) => t.status === 'in_progress')
  const pct = todos.length ? Math.round((done / todos.length) * 100) : 0
  return (
    <div className="todo-bar">
      <button className="todo-bar-head" onClick={() => setOpen((o) => !o)}>
        <span className="todo-bar-caret">{open ? '▾' : '▸'}</span>
        <span className="todo-bar-title">TASKS</span>
        <span className="todo-bar-prog">
          {done}/{todos.length}
        </span>
        {!open && current && (
          <span className="todo-bar-current">{current.activeForm || current.content}</span>
        )}
        <span className="todo-bar-track">
          <span className="todo-bar-fill" style={{ width: `${pct}%` }} />
        </span>
      </button>
      {open && (
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
      )}
    </div>
  )
}
