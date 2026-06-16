// Custom frameless-window titlebar (docs/MAINTAINABILITY.md Phase 3). Extracted
// verbatim from App.tsx — behavior-preserving, plus a desktop-pet toggle.
import { useEffect, useState, type JSX } from 'react'

export default function TitleBar(): JSX.Element {
  const [petOn, setPetOn] = useState(false)

  useEffect(() => {
    window.forge.pet
      .getEnabled()
      .then(setPetOn)
      .catch(() => {})
  }, [])

  const togglePet = async (): Promise<void> => {
    try {
      setPetOn(await window.forge.pet.toggle())
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="titlebar">
      <div className="titlebar-brand">
        <span className="brand-mark">⚒</span> CLAUDE FORGE
      </div>
      <div className="titlebar-controls">
        <button
          className="tb-btn"
          title={petOn ? 'Hide desktop pet' : 'Show desktop pet'}
          aria-pressed={petOn}
          onClick={togglePet}
          style={{ opacity: petOn ? 1 : 0.45 }}
        >
          🦀
        </button>
        <button className="tb-btn" title="Minimize" onClick={() => window.forge.window.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button className="tb-btn" title="Maximize" onClick={() => window.forge.window.maximize()}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button className="tb-btn close" title="Close" onClick={() => window.forge.window.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" />
            <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
