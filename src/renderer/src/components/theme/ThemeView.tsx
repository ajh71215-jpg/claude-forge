// The THEME tab — a theme marketplace. Built-in presets + user themes, each just
// a swap of the color CSS variables (lib/theme.ts owns the engine + presets). The
// preview cards render a tiny in-context mock of the real UI in that theme's own
// scoped variables, so you judge a theme by how the app looks, not by abstract
// swatches. Selecting applies instantly and persists; the custom editor live-
// applies your edits to the whole app as you make them.
import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react'
import Icon from '../Icon'
import { useConfirm } from '../ConfirmDialog'
import {
  BUILTIN_THEMES,
  DEFAULT_THEME,
  EDITOR_GROUPS,
  applyTheme,
  buildCustomTheme,
  contrastRatio,
  getCustomThemes,
  getSelectedId,
  isHex,
  resolveTheme,
  saveCustomThemes,
  setSelectedId,
  type Theme
} from '../../lib/theme'

const EDITABLE = EDITOR_GROUPS.flatMap((g) => g.rows.map((r) => r.var))

/** The theme's color vars as inline custom properties, to scope a subtree to it. */
function themeStyle(theme: Theme): CSSProperties {
  return theme.vars as unknown as CSSProperties
}

/** Pull just the editable identity vars out of a theme (to seed the editor). */
function identityOf(theme: Theme): Record<string, string> {
  const o: Record<string, string> = {}
  for (const v of EDITABLE) o[v] = theme.vars[v] ?? '#000000'
  return o
}

/** A compact, honest mock of the app rendered in one theme's scoped variables. */
function ThemePreview({ theme }: { theme: Theme }): JSX.Element {
  return (
    <div className="tp" style={themeStyle(theme)} aria-hidden="true">
      <div className="tp-rail">
        <span className="tp-mark" />
        <span className="tp-navdot on" />
        <span className="tp-navdot" />
        <span className="tp-navdot" />
      </div>
      <div className="tp-main">
        <div className="tp-card">
          <span className="tp-line strong" />
          <span className="tp-line" />
          <span className="tp-line short" />
        </div>
        <div className="tp-row">
          <span className="tp-pill">Aa</span>
          <span className="tp-ghost" />
        </div>
      </div>
    </div>
  )
}

interface Draft {
  id: string
  name: string
  identity: Record<string, string>
}

function ThemeEditor({
  draft,
  setDraft,
  onSave,
  onCancel
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  onSave: () => void
  onCancel: () => void
}): JSX.Element {
  const setVar = (v: string, value: string): void =>
    setDraft({ ...draft, identity: { ...draft.identity, [v]: value } })

  // Surface the most consequential contrast pair (body text on the base surface)
  // so a custom theme can't silently ship unreadable copy. WCAG AA body = 4.5:1.
  const ratio = contrastRatio(draft.identity['--text'] ?? '', draft.identity['--bg'] ?? '')
  const ratioOk = ratio >= 4.5
  const nameOk = draft.name.trim().length > 0

  return (
    <div className="theme-editor">
      <div className="te-head">
        <input
          className="te-name"
          value={draft.name}
          spellCheck={false}
          aria-label="Theme name"
          placeholder="Theme name"
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <div className="te-foot">
          <button className="theme-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" disabled={!nameOk} onClick={onSave}>
            Save theme
          </button>
        </div>
      </div>

      <div className="te-body">
        <div className="te-groups">
          {EDITOR_GROUPS.map((g) => (
            <fieldset className="te-group" key={g.title}>
              <legend className="te-group-title">{g.title}</legend>
              {g.rows.map((row) => {
                const val = draft.identity[row.var] ?? ''
                const valid = isHex(val)
                return (
                  <div className="te-row" key={row.var}>
                    <label className="te-row-label" htmlFor={`te-${row.var}`}>
                      {row.label}
                    </label>
                    <input
                      type="color"
                      className="te-swatch"
                      aria-label={row.label}
                      value={valid ? val : '#000000'}
                      onChange={(e) => setVar(row.var, e.target.value)}
                    />
                    <input
                      id={`te-${row.var}`}
                      className={`te-hex${valid ? '' : ' bad'}`}
                      value={val}
                      spellCheck={false}
                      onChange={(e) => setVar(row.var, e.target.value)}
                    />
                  </div>
                )
              })}
            </fieldset>
          ))}
        </div>

        <aside className="te-aside">
          <div className="te-aside-label">Live preview</div>
          <div className="te-preview">
            <ThemePreview theme={buildCustomTheme(draft.id, draft.name, draft.identity)} />
          </div>
          <div className={`te-contrast${ratioOk ? ' ok' : ' low'}`}>
            <span className="te-contrast-num">{ratio ? ratio.toFixed(1) : '–'}:1</span>
            <span className="te-contrast-note">
              {ratioOk ? 'text on base passes AA' : 'text on base is low (aim ≥ 4.5:1)'}
            </span>
          </div>
          <p className="te-hint">
            Edits apply to the whole app live. State colors (errors, success) stay fixed so
            warnings always read the same.
          </p>
        </aside>
      </div>
    </div>
  )
}

function ThemeCard({
  theme,
  active,
  onApply,
  onEdit,
  onDelete
}: {
  theme: Theme
  active: boolean
  onApply: () => void
  onEdit?: () => void
  onDelete?: () => void
}): JSX.Element {
  return (
    <div className={`theme-card${active ? ' active' : ''}`}>
      <button className="theme-card-apply" onClick={onApply} aria-pressed={active}>
        <div className="theme-card-preview">
          <ThemePreview theme={theme} />
        </div>
        <div className="theme-card-meta">
          <div className="theme-card-name">
            {theme.name}
            {active && <span className="theme-card-tag">Active</span>}
            {!theme.builtin && <span className="theme-card-tag custom">Custom</span>}
          </div>
          {theme.blurb && <div className="theme-card-blurb">{theme.blurb}</div>}
        </div>
      </button>
      {(onEdit || onDelete) && (
        <div className="theme-card-acts">
          {onEdit && (
            <button className="theme-card-act" onClick={onEdit} title="Edit theme">
              Edit
            </button>
          )}
          {onDelete && (
            <button className="theme-card-act danger" onClick={onDelete} title="Delete theme">
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function ThemeView(): JSX.Element {
  const confirm = useConfirm()
  const [customs, setCustoms] = useState<Theme[]>(() => getCustomThemes())
  const [selectedId, setSel] = useState<string>(() => getSelectedId())
  const [draft, setDraft] = useState<Draft | null>(null)

  // Live-apply the draft to the whole app while editing.
  useEffect(() => {
    if (draft) applyTheme(buildCustomTheme(draft.id, draft.name || 'Custom', draft.identity))
  }, [draft])

  const apply = (theme: Theme): void => {
    setDraft(null)
    applyTheme(theme)
    setSel(theme.id)
    setSelectedId(theme.id)
  }

  const startNew = (): void => {
    const base = resolveTheme(selectedId, customs) ?? DEFAULT_THEME
    const n = customs.length + 1
    setDraft({ id: `custom-${Date.now()}`, name: `Custom ${n}`, identity: identityOf(base) })
  }
  const startEdit = (theme: Theme): void => {
    setDraft({ id: theme.id, name: theme.name, identity: identityOf(theme) })
  }
  const cancelEdit = (): void => {
    setDraft(null)
    applyTheme(resolveTheme(selectedId, customs) ?? DEFAULT_THEME)
  }
  const saveDraft = (): void => {
    if (!draft || !draft.name.trim()) return
    const theme = buildCustomTheme(draft.id, draft.name.trim(), draft.identity)
    const next = customs.some((c) => c.id === theme.id)
      ? customs.map((c) => (c.id === theme.id ? theme : c))
      : [...customs, theme]
    setCustoms(next)
    saveCustomThemes(next)
    setDraft(null)
    applyTheme(theme)
    setSel(theme.id)
    setSelectedId(theme.id)
  }
  const deleteTheme = async (theme: Theme): Promise<void> => {
    if (!(await confirm({ message: `Delete the theme "${theme.name}"?`, danger: true }))) return
    const next = customs.filter((c) => c.id !== theme.id)
    setCustoms(next)
    saveCustomThemes(next)
    if (selectedId === theme.id) apply(DEFAULT_THEME)
  }

  const editingId = draft?.id
  const editorTheme = useMemo(
    () => (draft ? buildCustomTheme(draft.id, draft.name, draft.identity) : null),
    [draft]
  )

  return (
    <div className="theme-root">
      <div className="theme-bar">
        <div className="theme-bar-title">
          <Icon name="theme" className="theme-bar-mark" />
          Theme
        </div>
        <div className="theme-bar-sub">
          Recolor the forge. Presets apply instantly; build your own below.
        </div>
      </div>

      <div className="theme-scroll">
        {draft && editorTheme ? (
          <ThemeEditor draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={cancelEdit} />
        ) : (
          <>
            <section className="theme-section">
              <div className="theme-section-head">
                <h2 className="theme-section-title">Presets</h2>
              </div>
              <div className="theme-grid">
                {BUILTIN_THEMES.map((t) => (
                  <ThemeCard
                    key={t.id}
                    theme={t}
                    active={selectedId === t.id}
                    onApply={() => apply(t)}
                  />
                ))}
              </div>
            </section>

            <section className="theme-section">
              <div className="theme-section-head">
                <h2 className="theme-section-title">Your themes</h2>
                <button className="theme-btn" onClick={startNew}>
                  ＋ New theme
                </button>
              </div>
              {customs.length === 0 ? (
                <div className="theme-empty">
                  No custom themes yet. Start from the current colors and make it yours.
                </div>
              ) : (
                <div className="theme-grid">
                  {customs.map((t) => (
                    <ThemeCard
                      key={t.id}
                      theme={t}
                      active={selectedId === t.id && editingId !== t.id}
                      onApply={() => apply(t)}
                      onEdit={() => startEdit(t)}
                      onDelete={() => void deleteTheme(t)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
