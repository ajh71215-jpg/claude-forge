// CSS-variable theme engine. A "theme" is a recolor: it swaps the COLOR custom
// properties only (surfaces / borders / text / accent / state). Structural tokens
// (radius, spacing, type ramp, motion, shadows, fonts) are intentionally NOT
// themed, so every theme keeps the same layout and feel and only the palette
// changes. `00-core.css` owns the canonical default ("Amber, the Forge"); the
// built-in presets below mirror that token shape so the marketplace preview cards
// and the actually-applied theme read from ONE source (no drift). Custom themes
// are the same shape, persisted to localStorage. Pure + side-effect-free except
// applyTheme/initTheme which touch document.documentElement.
import { loadJson, saveJson } from './storage'

export interface Theme {
  id: string
  name: string
  /** One-line point of view shown under the name in the marketplace. */
  blurb?: string
  /** Built-in (shipped) vs user-created. The default Amber is also `builtin`. */
  builtin?: boolean
  /** CSS custom property name (incl. leading `--`) → value. */
  vars: Record<string, string>
}

// The full set of properties a theme controls. Order groups them by role; the
// editor and applyTheme both iterate this so a theme is always complete.
const SURFACE_VARS = ['--bg-deep', '--bg', '--bg-raised', '--bg-card', '--bg-float']
const BORDER_VARS = ['--border', '--border-strong']
const TEXT_VARS = ['--text', '--muted', '--faint']
const ACCENT_VARS = ['--amber', '--amber-bright', '--amber-dim', '--on-accent']
const STATE_VARS = ['--danger', '--danger-bright', '--ok', '--ok-bright', '--warn', '--info']
export const THEMEABLE_VARS = [
  ...SURFACE_VARS,
  ...BORDER_VARS,
  ...TEXT_VARS,
  '--accent-rgb',
  ...ACCENT_VARS,
  ...STATE_VARS
]

// Semantic state hues are universal signals (error = clay, success = green …),
// so they stay constant across themes for a predictable read. Presets and custom
// themes recolor identity (surfaces + accent), not the warning lights.
const STATE: Record<string, string> = {
  '--danger': '#d2806a',
  '--danger-bright': '#e2987f',
  '--ok': '#6fb98a',
  '--ok-bright': '#57cf83',
  '--warn': '#d8923c',
  '--info': '#8aa2c4'
}

/** "#bcae98" / "#bca" → "188, 174, 152" (for the rgba(var(--accent-rgb), a) washes). */
export function hexToRgb(hex: string): string {
  const h = hex.replace('#', '').trim()
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  if ([r, g, b].some((x) => Number.isNaN(x))) return '188, 174, 152'
  return `${r}, ${g}, ${b}`
}

/** True for a syntactically valid 3- or 6-digit hex color. */
export function isHex(s: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim())
}

// Built-in presets. Each keeps Amber's elevation architecture (5 surfaces in
// clear lightness steps for real depth) and tints the neutrals a whisper toward
// its own hue, so a theme reads as designed rather than "same gray + new accent".
// accent-rgb is set explicitly per preset to match its accent precisely.
function preset(
  id: string,
  name: string,
  blurb: string,
  identity: Record<string, string>
): Theme {
  return { id, name, blurb, builtin: true, vars: { ...identity, ...STATE } }
}

export const BUILTIN_THEMES: Theme[] = [
  preset('amber', 'Amber', 'The forge. Warm charcoal, restrained brass.', {
    '--bg-deep': '#0b0a09',
    '--bg': '#110f0d',
    '--bg-raised': '#181613',
    '--bg-card': '#1e1b18',
    '--bg-float': '#25221e',
    '--border': '#2b2825',
    '--border-strong': '#3b3733',
    '--text': '#ecebe8',
    '--muted': '#9d978c',
    '--faint': '#756f64',
    '--accent-rgb': '192, 182, 165',
    '--amber': '#bcae98',
    '--amber-bright': '#f1ede4',
    '--amber-dim': '#4b463e',
    '--on-accent': '#14120d'
  }),
  preset('slate', 'Slate', 'Cool night shift. Steel blue on cold charcoal.', {
    '--bg-deep': '#08090c',
    '--bg': '#0e1015',
    '--bg-raised': '#15181f',
    '--bg-card': '#1b1f28',
    '--bg-float': '#222734',
    '--border': '#2a2f3a',
    '--border-strong': '#3a4150',
    '--text': '#e7eaf0',
    '--muted': '#939bad',
    '--faint': '#6b7283',
    '--accent-rgb': '111, 155, 207',
    '--amber': '#6f9bcf',
    '--amber-bright': '#eaf1fb',
    '--amber-dim': '#2e3c50',
    '--on-accent': '#0a0e16'
  }),
  preset('forest', 'Forest', 'Quiet pine. Sage accent on deep green-black.', {
    '--bg-deep': '#080b09',
    '--bg': '#0e120f',
    '--bg-raised': '#151a16',
    '--bg-card': '#1b211d',
    '--bg-float': '#222a24',
    '--border': '#29322b',
    '--border-strong': '#3a463c',
    '--text': '#e8ece8',
    '--muted': '#98a399',
    '--faint': '#6e7a70',
    '--accent-rgb': '139, 184, 143',
    '--amber': '#8bb88f',
    '--amber-bright': '#ecf4ec',
    '--amber-dim': '#33453a',
    '--on-accent': '#0b130d'
  }),
  preset('graphite', 'Graphite', 'No color, all craft. Pewter on neutral ink.', {
    '--bg-deep': '#0a0a0b',
    '--bg': '#101012',
    '--bg-raised': '#171719',
    '--bg-card': '#1d1d20',
    '--bg-float': '#242428',
    '--border': '#2b2b2f',
    '--border-strong': '#3b3b40',
    '--text': '#ebebed',
    '--muted': '#9a9aa0',
    '--faint': '#717177',
    '--accent-rgb': '200, 201, 208',
    '--amber': '#c8c9d0',
    '--amber-bright': '#f4f4f7',
    '--amber-dim': '#44454c',
    '--on-accent': '#131316'
  }),
  preset('orchid', 'Orchid', 'Dusk. Muted mauve over cool violet-charcoal.', {
    '--bg-deep': '#0a080b',
    '--bg': '#100e13',
    '--bg-raised': '#17141a',
    '--bg-card': '#1d1a22',
    '--bg-float': '#25202b',
    '--border': '#2d2833',
    '--border-strong': '#3e3747',
    '--text': '#ece8ef',
    '--muted': '#9d96a6',
    '--faint': '#726b7c',
    '--accent-rgb': '169, 139, 184',
    '--amber': '#a98bb8',
    '--amber-bright': '#f1ecf5',
    '--amber-dim': '#443a4e',
    '--on-accent': '#140f17'
  })
]

export const DEFAULT_THEME = BUILTIN_THEMES[0]

// --- contrast (WCAG 2.1 relative luminance) — used to flag a low-contrast
// custom theme before the user saves it (text-on-background). -------------------
function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
function luminance(hex: string): number {
  const rgb = hexToRgb(hex).split(',').map((s) => parseInt(s.trim(), 10))
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}
/** Contrast ratio between two hex colors (1 → 21). */
export function contrastRatio(a: string, b: string): number {
  if (!isHex(a) || !isHex(b)) return 0
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// --- persistence --------------------------------------------------------------
const SELECTED_KEY = 'forge-theme'
const CUSTOM_KEY = 'forge-theme-custom'

export function getCustomThemes(): Theme[] {
  const list = loadJson<Theme[]>(CUSTOM_KEY, [])
  return Array.isArray(list) ? list.filter((t) => t && t.id && t.vars) : []
}
export function saveCustomThemes(list: Theme[]): void {
  saveJson(CUSTOM_KEY, list)
}
export function getSelectedId(): string {
  return loadJson<string>(SELECTED_KEY, DEFAULT_THEME.id)
}
export function setSelectedId(id: string): void {
  saveJson(SELECTED_KEY, id)
}

/** All themes the marketplace shows: built-ins first, then user themes. */
export function allThemes(customs = getCustomThemes()): Theme[] {
  return [...BUILTIN_THEMES, ...customs]
}
export function resolveTheme(id: string, customs = getCustomThemes()): Theme | undefined {
  return allThemes(customs).find((t) => t.id === id)
}

// --- apply --------------------------------------------------------------------
/**
 * Apply a theme by writing its color vars onto :root as inline overrides.
 * Selecting the built-in Amber instead REMOVES the overrides so the app defers
 * to the canonical stylesheet values (guaranteeing the brand look is identical,
 * never a hand-copied approximation). A `data-theme` attribute is set for any
 * CSS that wants to hook a specific theme.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme.id === DEFAULT_THEME.id) {
    for (const v of THEMEABLE_VARS) root.style.removeProperty(v)
  } else {
    for (const v of THEMEABLE_VARS) {
      const val = theme.vars[v]
      // A partial theme (older/imported) falls back to the Amber stylesheet for
      // any var it omits, rather than rendering a broken half-recolor.
      if (val) root.style.setProperty(v, val)
      else root.style.removeProperty(v)
    }
  }
  root.setAttribute('data-theme', theme.id)
}

/**
 * Apply the persisted theme. Called once from the renderer entry (main.tsx)
 * right after the stylesheet import, before React paints, so there's no flash of
 * the default theme on launch for users on a non-Amber theme.
 */
export function initTheme(): void {
  const theme = resolveTheme(getSelectedId()) ?? DEFAULT_THEME
  applyTheme(theme)
}

// Human labels for the custom-theme editor, grouped by role (state hues are
// shared, so they're not editable here — a custom theme recolors identity).
export const EDITOR_GROUPS: { title: string; rows: { var: string; label: string }[] }[] = [
  {
    title: 'Surfaces',
    rows: [
      { var: '--bg-deep', label: 'Deepest (titlebar, rails)' },
      { var: '--bg', label: 'Base' },
      { var: '--bg-raised', label: 'Raised (sidebar, composer)' },
      { var: '--bg-card', label: 'Card' },
      { var: '--bg-float', label: 'Floating (modals, menus)' }
    ]
  },
  {
    title: 'Lines',
    rows: [
      { var: '--border', label: 'Hairline' },
      { var: '--border-strong', label: 'Strong line' }
    ]
  },
  {
    title: 'Text',
    rows: [
      { var: '--text', label: 'Primary' },
      { var: '--muted', label: 'Muted' },
      { var: '--faint', label: 'Faint (hints, timers)' }
    ]
  },
  {
    title: 'Accent',
    rows: [
      { var: '--amber', label: 'Accent' },
      { var: '--amber-bright', label: 'Accent bright (links, headings)' },
      { var: '--amber-dim', label: 'Accent dim (rails, dividers)' },
      { var: '--on-accent', label: 'Text on accent' }
    ]
  }
]

/** Build a complete custom theme from edited identity vars (derives accent-rgb,
 * inherits the shared state hues). */
export function buildCustomTheme(id: string, name: string, identity: Record<string, string>): Theme {
  return {
    id,
    name,
    builtin: false,
    vars: { ...identity, '--accent-rgb': hexToRgb(identity['--amber'] ?? '#bcae98'), ...STATE }
  }
}
