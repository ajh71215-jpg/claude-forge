// Composer textarea input concerns extracted from Composer.tsx (behavior-
// preserving): the slash-command autocomplete menu and the persisted prompt
// history (↑/↓ recall). Keeps Composer focused on send/transcript wiring.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SlashCommand } from '../../types'
import { CLIENT_COMMANDS } from '../../lib/constants'

const HISTORY_KEY = 'forge-prompt-history'
const HISTORY_MAX = 100

export interface ComposerInput {
  /** Slash-command autocomplete. */
  matches: SlashCommand[]
  menuOpen: boolean
  menuSel: number
  setMenuIndex: React.Dispatch<React.SetStateAction<number>>
  setDismissed: React.Dispatch<React.SetStateAction<boolean>>
  acceptCommand: (cmd: SlashCommand) => void
  /** Keydown handler for the textarea: menu nav + history recall + Enter→send.
   * Returns true if it handled (and the caller should stop). */
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** Persist a sent prompt into the recall history. */
  record: (text: string) => void
  /** Reset the history cursor (call when the draft changes / on send). */
  resetCursor: () => void
}

export function useComposerInput(opts: {
  prompt: string
  setPrompt: (v: string) => void
  commands: SlashCommand[]
  taRef: React.RefObject<HTMLTextAreaElement | null>
  send: () => void
}): ComposerInput {
  const { prompt, setPrompt, commands, taRef, send } = opts
  const [menuIndex, setMenuIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [histIndex, setHistIndex] = useState<number | null>(null)
  const promptHistRef = useRef<string[]>([])

  // Load persisted prompt history once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      if (raw) promptHistRef.current = JSON.parse(raw)
    } catch {
      /* ignore */
    }
  }, [])

  // Slash-command autocomplete: active while typing "/name" (before any space).
  const slashQuery =
    prompt.startsWith('/') && !prompt.includes(' ') ? prompt.slice(1).toLowerCase() : null
  // Memoized so it isn't recomputed on every streaming flush; slashQuery is null
  // unless the prompt starts with "/", so the filter only runs while typing a
  // command. docs/PERFORMANCE.md lever 7.
  const matches = useMemo<SlashCommand[]>(
    () =>
      slashQuery !== null && !dismissed
        ? [...CLIENT_COMMANDS, ...commands]
            .filter(
              (c) =>
                c.name.toLowerCase().startsWith(slashQuery) ||
                (c.aliases ?? []).some((a) => a.toLowerCase().startsWith(slashQuery))
            )
            .slice(0, 8)
        : [],
    [slashQuery, dismissed, commands]
  )
  const menuOpen = matches.length > 0
  const menuSel = Math.min(menuIndex, matches.length - 1)

  function acceptCommand(cmd: SlashCommand): void {
    setPrompt('/' + cmd.name + ' ')
    setDismissed(false)
    setMenuIndex(0)
    taRef.current?.focus()
  }

  function record(text: string): void {
    const h = promptHistRef.current
    if (h[h.length - 1] !== text) {
      h.push(text)
      if (h.length > HISTORY_MAX) h.shift()
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(h))
      } catch {
        /* ignore */
      }
    }
  }

  function resetCursor(): void {
    setHistIndex(null)
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMenuIndex((i) => (i + 1) % matches.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMenuIndex((i) => (i - 1 + matches.length) % matches.length)
        return true
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        acceptCommand(matches[menuSel])
        return true
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return true
      }
    }
    // Prompt history recall (slash menu closed, caret at the very start).
    const ta = e.currentTarget
    if (e.key === 'ArrowUp' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      const h = promptHistRef.current
      if (h.length) {
        e.preventDefault()
        const idx = histIndex === null ? h.length - 1 : Math.max(0, histIndex - 1)
        setHistIndex(idx)
        setPrompt(h[idx])
        return true
      }
    }
    if (e.key === 'ArrowDown' && histIndex !== null) {
      e.preventDefault()
      const h = promptHistRef.current
      const idx = histIndex + 1
      if (idx >= h.length) {
        setHistIndex(null)
        setPrompt('')
      } else {
        setHistIndex(idx)
        setPrompt(h[idx])
      }
      return true
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
      return true
    }
    return false
  }

  return {
    matches,
    menuOpen,
    menuSel,
    setMenuIndex,
    setDismissed,
    acceptCommand,
    onKey,
    record,
    resetCursor
  }
}
