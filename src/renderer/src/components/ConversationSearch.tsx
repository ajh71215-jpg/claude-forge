// Cross-conversation search overlay (the in-transcript Ctrl/F only searches the
// open conversation). Queries every saved conversation's stored transcript in the
// main process (local read — no model, no tokens) and opens the chosen one.
import { useEffect, useRef, useState, type JSX } from 'react'
import type { SessionSearchHit } from '../types'

export default function ConversationSearch({
  onOpen,
  onClose
}: {
  onOpen: (sessionId: string) => void
  onClose: () => void
}): JSX.Element {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SessionSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced search as the user types (min 2 chars).
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setHits([])
      setSearched(false)
      return
    }
    setLoading(true)
    let cancelled = false
    const t = setTimeout(() => {
      window.forge.agent
        .searchSessions(query)
        .then((r) => {
          if (cancelled) return
          setHits(r)
          setSearched(true)
        })
        .catch(() => {
          if (!cancelled) setHits([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q])

  function open(id: string): void {
    onClose()
    onOpen(id)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal cs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">SEARCH ALL CONVERSATIONS</div>
        <input
          ref={inputRef}
          className="cs-input"
          placeholder="Search every saved conversation…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'Enter' && hits[0]) open(hits[0].sessionId)
          }}
        />
        <div className="cs-results">
          {loading && <div className="cs-note">searching…</div>}
          {!loading && searched && hits.length === 0 && (
            <div className="cs-note">No conversations match “{q.trim()}”.</div>
          )}
          {hits.map((h) => (
            <button key={h.sessionId} className="cs-hit" onClick={() => open(h.sessionId)}>
              <div className="cs-hit-top">
                <span className="cs-hit-title">{h.title}</span>
                <span className="cs-hit-count">
                  {h.matches} match{h.matches === 1 ? '' : 'es'}
                </span>
              </div>
              {h.snippet && <div className="cs-hit-snippet">{h.snippet}</div>}
            </button>
          ))}
        </div>
        <div className="cs-foot">Local search — reads stored transcripts only, no tokens.</div>
      </div>
    </div>
  )
}
