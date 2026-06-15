// Transcript search for the composer (Cmd/Ctrl+F filters the open conversation).
// Extracted from Composer.tsx (behavior-preserving). Gated on `isActive` so the
// global keydown only fires for the visible tab (all tabs stay mounted).
import { useEffect, useRef, useState } from 'react'
import type { Turn } from '../../types'
import { turnText } from '../../lib/composer'

export interface TranscriptSearch {
  search: string
  setSearch: React.Dispatch<React.SetStateAction<string>>
  searchOpen: boolean
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  searchRef: React.RefObject<HTMLInputElement | null>
  /** Normalized query (trimmed + lowercased). */
  q: string
  /** Turns matching the query (all turns when the query is empty). */
  shownTurns: Turn[]
}

export function useTranscriptSearch(turns: Turn[], isActive: boolean): TranscriptSearch {
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Cmd/Ctrl+F toggles the search box (Escape closes it). Only the visible tab
  // responds — every tab's Composer is mounted, so without this gate one Cmd+F
  // would toggle search in all of them at once.
  useEffect(() => {
    if (!isActive) return
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        requestAnimationFrame(() => searchRef.current?.focus())
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        setSearch('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen, isActive])

  const q = search.trim().toLowerCase()
  const shownTurns = q ? turns.filter((t) => turnText(t).includes(q)) : turns
  return { search, setSearch, searchOpen, setSearchOpen, searchRef, q, shownTurns }
}
