// Keyboard-shortcut help overlay (opened with Cmd/Ctrl+/ or the command palette).
// The app's shortcuts (Cmd+K palette, Ctrl+F search, history recall, slash
// commands, /goal) are otherwise undiscoverable; this is a cheap reference.
import { useEffect, type JSX } from 'react'

const MOD = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'

const GROUPS: { title: string; items: { keys: string; desc: string }[] }[] = [
  {
    title: 'Global',
    items: [
      { keys: `${MOD} K`, desc: 'Open the command palette' },
      { keys: `${MOD} /`, desc: 'Show this shortcuts help' }
    ]
  },
  {
    title: 'Chat',
    items: [
      { keys: 'Enter', desc: 'Send the message' },
      { keys: 'Shift Enter', desc: 'New line' },
      { keys: `${MOD} F`, desc: 'Search this conversation' },
      { keys: '↑ / ↓', desc: 'Recall previous prompts (empty composer)' },
      { keys: '/', desc: 'Slash-command menu (/model, /effort, /goal, …)' }
    ]
  },
  {
    title: 'Commands',
    items: [
      { keys: '/goal', desc: 'Run autonomously until an objective is met' },
      { keys: '/model · /effort', desc: 'Switch model / reasoning effort' },
      { keys: '/permission', desc: 'Change permission mode (plan/ask/auto-edit/yolo)' },
      { keys: '/clear · /compact', desc: 'New conversation · summarize context' }
    ]
  }
]

export default function ShortcutsHelp({ onClose }: { onClose: () => void }): JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">KEYBOARD SHORTCUTS</div>
        <div className="shortcuts-grid">
          {GROUPS.map((g) => (
            <div className="shortcuts-group" key={g.title}>
              <div className="shortcuts-group-title">{g.title}</div>
              {g.items.map((it) => (
                <div className="shortcuts-row" key={it.desc}>
                  <span className="shortcuts-keys">
                    {it.keys.split(' ').map((k, i) => (
                      <kbd className="shortcuts-kbd" key={i}>
                        {k}
                      </kbd>
                    ))}
                  </span>
                  <span className="shortcuts-desc">{it.desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
