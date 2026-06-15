// Command palette (Cmd/Ctrl+K). A keyboard-first launcher over the actions the
// shell already exposes — switch tabs, change model/effort/permission, resume a
// conversation, customize the agent, etc. Actions are supplied by MainShell so
// the palette stays a dumb, reusable list view.
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'

export interface PaletteAction {
  id: string
  label: string
  /** Grouping label shown on the right (e.g. "Go to", "Model"). */
  section?: string
  /** Secondary hint (e.g. a shortcut). */
  hint?: string
  /** Extra text matched by the filter but not displayed. */
  keywords?: string
  run: () => void
}

export default function CommandPalette({
  actions,
  onClose
}: {
  actions: PaletteAction[]
  onClose: () => void
}): JSX.Element {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return actions
    return actions.filter((a) =>
      `${a.label} ${a.hint ?? ''} ${a.keywords ?? ''} ${a.section ?? ''}`
        .toLowerCase()
        .includes(s)
    )
  }, [q, actions])

  useEffect(() => {
    setSel(0)
  }, [q])

  // Keep the active row in view as the selection moves.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.palette-item.on')
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  function run(a?: PaletteAction): void {
    if (!a) return
    onClose()
    a.run()
  }

  function onKey(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((i) => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(filtered[sel])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command…  (↑↓ to navigate, ↵ to run)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && <div className="palette-empty">No matching command</div>}
          {filtered.map((a, i) => (
            <button
              key={a.id}
              className={`palette-item ${i === sel ? 'on' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(a)}
            >
              <span className="palette-label">{a.label}</span>
              {a.hint && <span className="palette-hint">{a.hint}</span>}
              {a.section && <span className="palette-section">{a.section}</span>}
            </button>
          ))}
        </div>
        <div className="palette-foot">↑↓ navigate · ↵ run · esc close</div>
      </div>
    </div>
  )
}
