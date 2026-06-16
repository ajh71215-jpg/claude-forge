// Settings panel — a discoverable home for the global preferences that are
// otherwise scattered (LIMITS in the sidebar, pet in the titlebar) plus local
// data management that lives nowhere else. Bound to the same state as the sidebar
// so there's a single source of truth (no divergence). Local-only.
import { useEffect, useState, type JSX } from 'react'
import { useConfirm } from './ConfirmDialog'
import type { LazySetting } from '../types'

const LAZY_LEVELS: { value: LazySetting; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Normal mode. (The "ponytail" / "lazy mode" keyword still works per message.)' },
  { value: 'lite', label: 'Lite', hint: 'Offer the lazy path as an alternative; don’t force it.' },
  { value: 'full', label: 'Full', hint: 'Enforce the ladder — stop at the first rung that works.' },
  { value: 'ultra', label: 'Ultra', hint: 'YAGNI extremist — challenge whether the requirement is even needed.' }
]

export default function Settings({
  maxBudget,
  onSetMaxBudget,
  autoCompact,
  onSetAutoCompact,
  lazyLevel,
  onSetLazyLevel,
  onClose
}: {
  maxBudget: number
  onSetMaxBudget: (n: number) => void
  autoCompact: boolean
  onSetAutoCompact: (v: boolean) => void
  lazyLevel: LazySetting
  onSetLazyLevel: (v: LazySetting) => void
  onClose: () => void
}): JSX.Element {
  const confirm = useConfirm()
  const [petOn, setPetOn] = useState<boolean | null>(null)

  useEffect(() => {
    window.forge.pet
      .getEnabled()
      .then(setPetOn)
      .catch(() => setPetOn(false))
  }, [])

  async function togglePet(): Promise<void> {
    const next = await window.forge.pet.setEnabled(!petOn)
    setPetOn(next)
  }

  function clearKey(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }

  async function resetAll(): Promise<void> {
    const ok = await confirm({
      message:
        'Reset all Forge local data? This clears prompt history, pinned conversations, ' +
        'the conversation→workspace map, and saved LIMITS. Your conversations and ' +
        'workspaces on disk are NOT touched.',
      danger: true,
      confirmLabel: 'Reset'
    })
    if (!ok) return
    for (const k of [
      'forge-prompt-history',
      'forge-pinned',
      'forge-session-ws',
      'forge-max-turns',
      'forge-max-budget',
      'forge-auto-compact',
      'forge-lazy-level',
      'forge-stick-bottom'
    ])
      clearKey(k)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">SETTINGS</div>

        <div className="settings-section">
          <div className="settings-section-title">Safety limits</div>
          <label className="settings-row">
            <span className="settings-label">Max $ / run</span>
            <input
              type="number"
              min={0}
              step={0.5}
              placeholder="off"
              value={maxBudget || ''}
              onChange={(e) => onSetMaxBudget(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={autoCompact}
              onChange={(e) => onSetAutoCompact(e.target.checked)}
            />
            Auto-compact at 80% context
          </label>
          <div className="settings-hint">
            Per-model max turns + the model/effort/permission selectors live in the sidebar.
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Lazy mode (ponytail)</div>
          <label className="settings-row">
            <span className="settings-label">Intensity</span>
            <select
              value={lazyLevel}
              onChange={(e) => onSetLazyLevel(e.target.value as LazySetting)}
            >
              {LAZY_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <div className="settings-hint">
            {LAZY_LEVELS.find((l) => l.value === lazyLevel)?.hint} When on, every run is told to
            write the laziest solution that works (YAGNI → stdlib → native → existing dep →
            one-liner) — never trading away validation, error handling, security, or accessibility.
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Appearance</div>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={!!petOn}
              disabled={petOn === null}
              onChange={togglePet}
            />
            Show the desktop pet (Clawd)
          </label>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Local data</div>
          <div className="settings-actions">
            <button className="ghost" onClick={() => clearKey('forge-prompt-history')}>
              Clear prompt history
            </button>
            <button className="ghost danger-text" onClick={resetAll}>
              Reset all local data…
            </button>
          </div>
          <div className="settings-hint">
            Local-only — nothing here is sent anywhere. Conversations/workspaces on disk are
            managed from the sidebar.
          </div>
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
