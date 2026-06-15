# DESIGN.md — Claude Forge Design System

Authoritative reference for the visual and interaction design of **Claude Forge**. This is the persisted source of truth that keeps future UI work consistent. Every token and pattern below is extracted from the actual implementation — file paths are cited inline. **When in doubt, the code wins; if you change the code, update this doc.**

The whole theme is driven by CSS custom properties in [`src/renderer/src/styles/00-core.css`](../src/renderer/src/styles/00-core.css). Components reference variables (`var(--…)`), never raw hex. Edit the **partials** under `src/renderer/src/styles/`, never the `styles.css` index (see §9).

---

## 1. Brand & tone

**Identity:** a "dark amber blacksmith forge" — a daily-driver forge for agentic work. The name and metaphor (forge / anvil / hammer) carry the brand, but the *visual* execution is deliberately restrained.

**Aesthetic: quiet premium.** Despite the "amber" name, the realized palette is **near-monochrome warm-gray**, not orange. The comment at the top of `00-core.css` states the intent verbatim:

> Quiet-premium neutral base — calm, Cursor-CLI restraint. Near-monochrome surfaces with one whisper of warm brass as the single accent.

So: calm dark surfaces, generous letter-spacing on labels, one low-chroma warm accent used sparingly for active/selected/links. No loud orange, no gradients-as-decoration (the only gradients are barely-there radial washes at `~0.05` alpha behind the main pane — `02-sidebar.css` `.main`).

**The anvil mark — `⚒`** (U+2692 HAMMER AND PICK). This is the single brand glyph, rendered in `--amber` (warm gray) via the `.brand-mark` class. It prefixes the wordmark everywhere:
- `CLAUDE FORGE` in the titlebar ([`TitleBar.tsx`](../src/renderer/src/components/TitleBar.tsx)) and auth gate ([`AuthGate.tsx`](../src/renderer/src/components/AuthGate.tsx))
- `FORGE` in the sidebar ([`Sidebar.tsx`](../src/renderer/src/components/Sidebar.tsx))
- the empty-transcript "anvil" splash (`.anvil-mark`, 56px, in `--amber-dim`)
- the Agents (`SquadView`) and Guide (`GuideView`) section marks

The **Cost & Cache** tab uses a different secondary glyph, `⛁` (U+26C1), as its bar/empty mark ([`CostView.tsx`](../src/renderer/src/components/cost/CostView.tsx)). These two emoji-style glyphs are the *only* sanctioned non-icon marks — everything else is a line icon (§5).

---

## 2. Color tokens

All colors are CSS variables on `:root` in `00-core.css`. Use the variable, never the literal. The accent is expressed two ways: `--amber*` named tokens for solid fills/text, and `--accent-rgb` (a bare `r, g, b` triple) for every translucent wash via `rgba(var(--accent-rgb), α)` — this keeps the glow/hover system on one hue.

### Surface & structure (warm-charcoal elevation ramp)

The surfaces step in clear ~+6 lightness increments (deepest → floating) so elevation reads as **real depth**, and every neutral is tinted a *whisper* toward the warm brand hue (warm charcoal, not cold gray). No pure black — the base is an off-black charcoal with headroom.

| Token | Value | Use |
|---|---|---|
| `--bg-deep` | `#0b0a09` | titlebar, tab strips, nav rails (`.mode-tabs`, `.chat-tabs`), deepest insets |
| `--bg` | `#110f0d` | app background, inputs, card insets, the base layer |
| `--bg-raised` | `#181613` | sidebar, composer, command bars, raised panels |
| `--bg-card` | `#1e1b18` | response cards, tool cards, on-surface panels |
| `--bg-float` | `#25221e` | **floating layers only**: modals, palette, popovers, menus (paired with `--shadow-modal`/`--shadow-pop` + `--edge-light`) |
| `--border` | `#2b2825` | default 1px hairline border everywhere (warm) |
| `--border-strong` | `#3b3733` | emphasized borders (active tabs, palette, checkbox idle) |

### Text (warm off-white ramp)

| Token | Value | Use |
|---|---|---|
| `--text` | `#ecebe8` | primary body / UI text |
| `--muted` | `#9d978c` | secondary text, descriptions, inactive labels |
| `--faint` | `#756f64` | tertiary — hints, elapsed timers, footers, placeholders |

### Accent — low-chroma warm brass (the "amber" family)

| Token | Value | Use |
|---|---|---|
| `--accent-rgb` | `192, 182, 165` | the accent as an RGB triple — feeds **every** translucent wash/glow: `rgba(var(--accent-rgb), α)` (washes typically `0.08–0.16`, focus ring `0.5`, selection `0.26`) |
| `--amber` | `#bcae98` | primary/active solid fills, strong active borders, the brand mark |
| `--amber-bright` | `#f1ede4` | active text, links, headings, selected labels (near-white) |
| `--amber-dim` | `#4b463e` | dim dividers, ghost/hover borders, accent rails, scrollbar thumb |
| `--on-accent` | `#14120d` | text/icon sitting **on** an `--amber` fill (e.g. `.primary` button label, `.tool-icon` glyph, `.plan-badge`) |

### Semantic state colors

The accent is **one locked hue**; these are reserved *state* colors (not decorative accents). `--info` is the single sanctioned second hue, used only to distinguish subagent / orchestration / procedural-memory state.

| Token | Value | Use |
|---|---|---|
| `--ok` | `#6fb98a` | success / additions / cache-good (muted green) |
| `--ok-bright` | `#57cf83` | live **connected** status dot (vivid) — `.mcp-dot.ok`, `.persona-dot.on`, `.conn-dot`, `.tool-badge.ok` |
| `--warn` | `#d8923c` | warning (`.mcp-dot.warn`) |
| `--danger` | `#d2806a` | destructive / errors / rate-limit / STOP (muted clay-red) |
| `--danger-bright` | `#e2987f` | danger hover (`.primary.danger:hover`) |
| `--info` | `#8aa2c4` | muted slate — **second semantic hue**: subagent / orchestration kind (`.ad-card.orchestration`, `.ad-kind.orchestration`), procedural memory (`.mem-procedural`) |

**Remaining semantic literals** (localized to chat diffs, prefer a token where one exists): diff add/del use GitHub-ish `#7ee787`/`#ffa198` over `rgba(46,160,67,0.16)`/`rgba(248,81,73,0.16)`; the titlebar close-button hover is `#c0392b`. New work should lean on the tokens above rather than minting more literals.

### Fonts (in the color block for proximity)

| Token | Value |
|---|---|
| `--sans` | `'Pretendard Variable', 'Pretendard', system-ui, sans-serif` |
| `--mono` | `'Cascadia Code', 'JetBrains Mono', 'Consolas', 'Pretendard Variable', 'Pretendard', ui-monospace, monospace` |

### Elevation

Flat by default; depth appears **only on floating layers**. The drops use a negative spread so they stay tight and premium rather than a soft AI haze. `--edge-light` is a 1px top inner-highlight (a catch-light) layered on raised panels for a physical, lifted feel.

| Token | Value | Use |
|---|---|---|
| `--shadow-soft` | `0 1px 2px rgba(0,0,0,0.4)` | minimal lift |
| `--shadow-pop` | `0 16px 40px -8px rgba(0,0,0,0.55)` | popovers, menus (export/slash) |
| `--shadow-modal` | `0 28px 70px -16px rgba(0,0,0,0.72)` | modals, palette, gate card |
| `--edge-light` | `inset 0 1px 0 rgba(255,255,255,0.04)` | top catch-light on raised/floating panels (`.composer`, `.mode-tab.on`, `.primary`, modals, palette) |

### Systematic scales (added in the design-taste redesign)

Token scales for radius, spacing, and type sit on `:root` so future work is systematic instead of ad-hoc px. The values match the established usage below; **new rules should reference the scale tokens.**

- **Radius** `--r-1`…`--r-5` = `4 / 6 / 8 / 10 / 12px`, plus `--r-pill: 999px`.
- **Spacing** `--sp-1`…`--sp-6` = `4 / 8 / 12 / 16 / 24 / 32px` (4px base).
- **Type ramp** (~1.2 step): `--fs-micro 10` · `--fs-xs 11` · `--fs-sm 12` · `--fs-base 13.5` · `--fs-md 15` · `--fs-lg 18` · `--fs-xl 22` (px).

---

## 3. Typography

**Two families, by role:**
- **`--sans` (Pretendard)** — all UI chrome and prose: labels, body text, markdown bodies (`.md`), composer input, persona/confirm message text. This is the default `body` font.
- **`--mono`** — reserved for **data, code, and agent output**: code spans/blocks in markdown, the streaming `response-text`, `thinking-text`, the live-activity strip text (`.ls-text`), numeric limit inputs, diffs, and the composer prompt chevron.

Pretendard is pinned *last* in `--mono` on purpose: the Latin monospace fonts lack Hangul glyphs, so per-glyph fallback renders Korean in Pretendard while Latin/code stay monospaced (see the comment in `00-core.css`).

**Base metrics** (`body` in `00-core.css`):
- font-size `14px`, `letter-spacing: -0.003em`, `font-family: var(--sans)`
- `-webkit-font-smoothing: antialiased`, `text-rendering: optimizeLegibility`
- `user-select: none` globally — text selection is *opted back in* per region with `user-select: text` (transcript, modal args, inputs).

**Tabular numerics.** Any data-bearing number must use tabular figures. `00-core.css` applies `font-variant-numeric: tabular-nums` to `.mono, code, kbd, samp, pre`; data UI also sets it directly (elapsed timers, the cost table, palette hints, context gauge counts). **Use `tabular-nums` for every number that updates in place** (timers, token counts, costs, percentages) so digits don't jitter.

**Label convention.** Small caps-style labels are lowercase/uppercase text with wide tracking, e.g. `.selector-label` (`font-size: 10px; letter-spacing: 0.16em; color: var(--faint)`), `.modal-title` (`0.18em`, `--amber`), section heads `0.04–0.08em`. Tracking *increases* as size decreases.

---

## 4. Spacing, radius, elevation

**Radius scale** (now tokenized as `--r-1`…`--r-5`; values used verbatim across components):
- `4px` (`--r-1`) — tiny chips, checkboxes, badges, focus-ring rounding, bar fills
- `5–6px` — small controls: `.mini-btn`, `.effort-cell`, `select`, `.msg-act`, scrollbar thumb, tool-icon
- `7px` — cards in lists: `.model-card`, `.perm-card`, `.palette-item`, `.modal-arg`
- `8px` — standard buttons, panels, tool cards, todo cards, `.saver-toggle`, `.persona-text`
- `10px` — response cards, composer input, cost stat tiles, slash menu, user message
- `12px` — modals (`.modal`), palette container, command-bar containers
- `14px` — drop-overlay inner
- `999px` / `50%` — pills (`.mode-chip`, `.subagent-toggle`, `.palette-section`) and dots

**Borders.** The universal pattern is **1px solid `--border`**. Emphasis escalates the *color*, not the width: idle `--border` → hover `--amber-dim` → active/selected `--amber` (occasionally `--border-strong`). A **2px left accent rail** (`border-left: 2px solid var(--amber-dim|amber)`) marks nested/special content: thinking blocks, subagent tool nests, the todo card, blockquotes.

**Shadows / elevation.** Flat by default. Elevation appears only on floating layers:
- modals: `0 24px 60px rgba(0,0,0,0.6)` (`.modal`)
- palette: `0 24px 64px rgba(0,0,0,0.55)`
- popovers (export/slash menus): `0 8px 24px` / `0 16px 40px rgba(0,0,0,0.4–0.5)`
- tokens `--shadow-soft` / `--shadow-pop` exist for reuse.

Overlays dim the backdrop with `rgba(0,0,0,0.45–0.55)`; the palette and drop overlay add `backdrop-filter: blur(2px)`.

---

## 5. Iconography

**One unified monochrome line-icon family** — [`src/renderer/src/components/Icon.tsx`](../src/renderer/src/components/Icon.tsx). Rules baked into the `Icon` component:
- **24×24 viewBox grid**, `fill="none"`, `stroke="currentColor"`, **`strokeWidth={1.75}`**, round caps + joins
- sizes to `1em` and inherits `currentColor` (`.icon` class in `00-core.css`, `vertical-align: -0.14em`), so every icon picks up the surrounding text color and stays on-theme automatically

**Icon names** (the `IconName` union): `chat`, `squad`, `extend`, `skills`, `commands`, `hooks`, `mcp`, `agents`, `plugins`, `bolt`, `tool`, `guide`, `cost`.

**Hard rule: no multicolor emoji in the UI.** This icon set explicitly replaced the old `🧩 ⌨ 🪝 🔌 🤖 📦 ⚡` emoji that ignored the palette (see the file header comment). The only sanctioned glyph-marks are the brand `⚒` and the cost `⛁` (§1) — and those render in a theme color via `currentColor`. New iconography goes through `Icon.tsx`; add a path to `PATHS`, don't drop in an emoji.

---

## 6. Components — canonical patterns

### Buttons
- **`.primary`** ([`01-auth.css`](../src/renderer/src/styles/01-auth.css)) — solid `--amber` fill, `--on-accent` text, bold, `border-radius: 8px`. Hover → `--amber-bright`; `:disabled` → `opacity: 0.4`. Variants reset width/margin/padding to inline-size themselves (`.primary.send`, `.modal-actions .primary`).
- **`.primary.danger`** ([`02-sidebar.css`](../src/renderer/src/styles/02-sidebar.css)) — destructive confirm; `background: var(--danger)`, hover `#e09177`.
- **`.ghost`** — transparent, `1px var(--border)`, muted text; hover turns text + border `--danger` (it's the "discard / sign-out" affordance). `margin-top: auto` parks it at the bottom of the sidebar.
- **`.mini-btn`** — tiny bordered text button for in-header actions; `font-size: 10px; letter-spacing: 0.06em`, hover/`.on` fill with `rgba(var(--accent-rgb), 0.1–0.16)`.
- **`.stop`** — outlined `--danger` (transparent fill), bold, wide tracking; hover gets a faint red wash.
- Inline text buttons: `.link-reset` (underlined `--amber-bright`), `.msg-act` (bordered, hover → `--amber-bright`).

### Modals
Pattern (see [`ConfirmDialog.tsx`](../src/renderer/src/components/ConfirmDialog.tsx) for the canonical structure):
```
.modal-overlay  (position:fixed; inset:0; rgba(0,0,0,0.55); grid place-items:center; z-index:50)
  └ .modal      (width:440px; max-width:90vw; bg --bg-card; border 1px --amber-dim; radius 12px; shadow 0 24px 60px)
      ├ .modal-title    (10–11px, 0.18em tracking, --amber)
      ├ …body…          (.modal-arg / .confirm-msg / etc.)
      └ .modal-actions  (flex; justify-content:flex-end; gap:10px) → [.ghost cancel] [.primary confirm]
```
Click-on-overlay cancels; click-on-`.modal` stops propagation. Keyboard: **Enter confirms, Escape cancels** (wired in `ConfirmDialog`). Width variants: `.confirm-modal` 400, `.persona-modal` 560, `.help-modal` 520, `.question-modal` 560. Prefer the promise-based **`useConfirm()`** hook over native `window.confirm` (native chrome ignores the theme).

### Custom form controls
Native OS widgets are replaced so the UI looks identical on every platform (`00-core.css` "custom form controls"). **Never ship a raw native checkbox/select/number spinner.**
- **Checkbox** — `appearance: none`, 16×16, `radius 4px`, `1px var(--border-strong)`. `:hover` border → `--amber`. `:checked` fills `--amber` and paints an inline-SVG check (stroke `#0d0d0e`). (Some toggles instead use a native input tinted with `accent-color: var(--amber)` — e.g. `.saver-toggle input`, `.limit-check input`.)
- **Number** — spin buttons stripped (`appearance: textfield` + `::-webkit-*-spin-button { appearance: none }`).
- **Select** — `appearance: none`, themed closed control (`--bg`, `1px --border`, `radius 6px`), custom chevron painted as a `--muted`-stroked inline SVG at right. `:focus` border → `--amber`. The popup list stays native (unavoidable for `<select>`); `option` is tinted `--bg-card`.

### Cards & selectable rows
The repeated "selectable card" pattern (`.model-card`, `.perm-card`, `.conv-row`, `.persona-mode-btn`, `.effort-cell`, `.q-option`):
- base: `background: var(--bg)`, `1px var(--border)`, `radius 6–8px`, left-aligned, `transition: all 0.12s`
- `:hover` → border `--amber-dim` (text often → `--text`)
- `.on` / `.selected` → border `--amber`, `background: rgba(var(--accent-rgb), 0.08)`, title text → `--amber-bright`

**Tool card** (`.tool-card`, [`03-chat.css`](../src/renderer/src/styles/03-chat.css)): `--bg-card` body, `.running` → `--amber-dim` border, `.error` → `--danger` border. `.tool-icon` is a 22×22 `--amber` square with `--on-accent` glyph. Status via `.tool-badge.{ok|error|running}` (running pulses). Subagent inner tools nest under `.subagent-nest` (left rail) and render as `.tool-card.nested`.

### Tabs
- **`.mode-tabs`** (top-level view switcher, `02-sidebar.css`) — `--bg-deep` strip; `.mode-tab` is transparent+muted, hover → `--text`, `.on` → `--amber-bright` text on `--bg-card` with `--border-strong`. Each tab pairs an `Icon` (`1.32em`, dimmed when inactive) with a wide-tracked label.
- **`.chat-tabs`** (concurrent conversation tabs, `03-chat.css`) — folder-style tabs (`radius 7px 7px 0 0`, `border-bottom:none`), `.on` lifts to `--bg`; each has a `.chat-tab-x` close and a `.chat-tab-new` (+) affordance (disabled at the 5-tab cap).

### Command palette (Cmd/Ctrl+K)
[`CommandPalette.tsx`](../src/renderer/src/components/palette/CommandPalette.tsx) + [`08-palette.css`](../src/renderer/src/styles/08-palette.css). `.palette-overlay` (z-index 200, blur) → `.palette` (`min(560px,92vw)`, `--bg-card`, `radius 12px`). Borderless `.palette-input` with a bottom hairline; `.palette-list` of `.palette-item` rows; selected row `.on` uses `color-mix(in srgb, var(--amber) 12%, var(--bg-raised))` and brightens its label. Each row: `.palette-label` (flex-1, ellipsis) + optional `.palette-hint` (faint, tabular) + `.palette-section` (uppercase pill). Footer shows the key legend. Fully keyboard-driven (↑↓ / ↵ / esc), mouse-hover updates selection.

### Confirm dialog
See **Modals** above — `ConfirmDialog.tsx` is the reference implementation (overlay + `.modal.confirm-modal` + `.confirm-msg` + `.modal-actions`), exposed as `useConfirm()`.

### Badges, chips, pills, dots
- **Badge** — `.plan-badge` / `.tool-badge` / `.q-header`: tiny, wide-tracked. `.plan-badge` is a solid `--amber` chip with `--on-accent` text; `.q-header` is an `rgba(var(--accent-rgb),0.12)` chip with `--amber-dim` border.
- **Chip / pill** — `radius 999px`, hairline border, hover fills with `rgba(var(--accent-rgb), 0.1)`: `.persona-chip` (preset prompts), `.mode-chip` (magic-keyword modes, accent-tinted via `color-mix`), `.subagent-toggle`, `.palette-section`.
- **Status dot** — 7px circle: idle `--muted`; connected/`.ok` `#4ccb6a` with a soft glow; `.pending` `--amber`; `.warn` `#d8923c`; `.err`/`.danger`. Running dots pulse.

---

## 7. Layout

**Shell.** `.app` is a vertical flex column: `.titlebar` (34px, `-webkit-app-region: drag`, custom window controls) over `.app-body` (`flex:1; min-height:0`). Inside, `.shell` is a CSS **grid `280px 1fr`** — fixed sidebar + fluid main (`02-sidebar.css`).

- **`.sidebar`** — `--bg-raised`, right hairline, `padding 26px 22px`, vertical flex, `gap: 26px`, scrolls independently. Holds the brand, selectors (model/effort/permission cards), usage panels, persona card, and the bottom `.ghost`.
- **`.main`** — `grid; place-items:center` with a barely-there radial accent wash over `--bg`. Hosts the view router.
- **`.view-pane`** — `flex:1; min-height:0; flex-direction:column`, and `.view-pane > * { flex:1; min-height:0 }` so each view fills. Views: chat / squad (Agents) / cost / extend / guide.

**Flexbox convention (critical).** In a flex column, **use `flex: 1; min-height: 0` to make a child fill, NOT `height: 100%`.** Percentage-height resolution against flex items is fragile in Chromium (see `CLAUDE.md` Gotchas). This pattern is everywhere: `.app-body`, `.view-pane`, `.transcript`, `.cost-root`/`.cost-scroll`, `.palette-list`, scroll regions. Pair scroll containers with `overflow-y: auto; min-height: 0`. Use `min-width: 0` on flex children that must ellipsis-truncate.

---

## 8. Interaction states

**Motion tokens** (`00-core.css`, added per the installed `design-taste` skill). Curves are explicit, not the weak CSS built-ins:
- `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` — enter/press feedback (starts fast = responsive); the default for state changes.
- `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` — on-screen movement/morph.
- `--dur-1: 0.12s` (state changes), `--dur-2: 0.2s` (larger transitions).

**Transitions.** Short and uniform: card/tab/button state changes use **`transition: all var(--dur-1) var(--ease-out)`**; `0.15s` for inputs; `0.3s` for bar-fill width animations. Pure *color/hover* fades keep the default `ease` (the skill's decision tree: hover/color → `ease`, enter/press/movement → custom curve) — only escalate to `--ease-out` when a `transform`/lift is involved.

**Reduced motion (mandatory).** A global `@media (prefers-reduced-motion: reduce)` block in `00-core.css` collapses every animation/transition to near-instant (and stops the looping `spin`/`pulse`/`blink`) while preserving comprehension-aiding color/opacity end-states. Every new looping animation is covered automatically by the universal selector — don't reintroduce motion that ignores the OS preference.

**Typography wrapping.** Markdown headings (`.md h1–h4`) use `text-wrap: balance`; prose (`.md p`) uses `text-wrap: pretty` (no orphan words / even ragged edge).

**Hover** — borders brighten one step (`--border` → `--amber-dim` → `--amber`); muted text → `--text` or `--amber-bright`; subtle accent wash `rgba(var(--accent-rgb), 0.08–0.16)` on selectable rows.

**Active** — `button:active:not(:disabled) { transform: translateY(0.5px) }` (a global tactile press in `00-core.css`).

**Focus** — global `:focus-visible { outline: 2px solid rgba(var(--accent-rgb), 0.5); outline-offset: 1px }`. Inputs additionally pull the border to `--amber`/`--amber-dim` and (composer/persona text) add `box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.12)`.

**Disabled** — `opacity: 0.35–0.4` + `cursor: not-allowed`; hover styles are neutralized (e.g. `.effort-cell:disabled:hover` resets border/color).

**Selection** — `::selection { background: rgba(var(--accent-rgb), 0.26) }`.

**Scrollbars** — thin, `--amber-dim` thumb on transparent track (`scrollbar-color` + `::-webkit-scrollbar*`), thumb `#3a3024` → hover `--amber-dim`, with a 2px `--bg` inset border.

**Keyframes** (defined in `03-chat.css`, used globally):
- **`spin`** — `to { transform: rotate(360deg) }`, `0.7s linear infinite` — loading spinners (`.tool-spin`, `.ls-spinner`, `.goal-spinner`, `.rb-spin`), each a ring with `--amber` top-border over a translucent accent ring (`color-mix(in srgb, var(--amber) 30–35%, transparent)`).
- **`pulse`** — opacity `0.45 → 1 → 0.45`, `~1.1–1.4s ease-in-out infinite` — running badges/dots, the `.forging-dot`, cost live `.ct-dot`.
- **`blink`** — `50% { opacity: 0 }`, `1s steps(1) infinite` — the streaming `.caret`.

---

## 9. CSS architecture & rules

**Index + partials.** [`styles.css`](../src/renderer/src/styles.css) is a **thin `@import` index only** — the real CSS lives in ordered partials under `src/renderer/src/styles/`. Import order is load-bearing (cascade + CSS-nesting behavior depend on it):

| Partial | Covers |
|---|---|
| `00-core.css` | theme vars, resets, scrollbars, custom form controls, `.icon`, focus/selection, boot, brand |
| `01-auth.css` | first-run gate, auth-method chooser, connection chip, `.primary` |
| `02-sidebar.css` | main shell, sidebar selectors, usage/sessions, persona + modals, `.mode-tabs`, `.ghost` |
| `03-chat.css` | transcript: markdown, turns, thinking, tool cards, todo, dialogs, composer, **spinner/pulse/blink keyframes** |
| `04-extend.css` | EXTEND console (skills/commands/hooks/mcp/plugins) |
| `05-squad.css` | Agents activity dashboard (live + history) |
| `06-guide.css` | Guide tab — first-run tour |
| `07-cost.css` | Cost & Cache dashboard |
| `08-palette.css` | command palette |

**Rule: edit the partials, not the index.** (Stated in both `styles.css` and `CLAUDE.md`.)

**The unclosed-brace footgun (must-know).** A single stray `{` in a partial makes Chromium's **CSS nesting** silently swallow every following rule as a descendant — rules quietly stop matching (a dangling `.session-cost {` once broke the entire chat layout). After editing any partial, **sanity-check brace balance per file**: `grep -o '{' file | wc -l` must equal `grep -o '}' file | wc -l`.

**Shared keyframes live in `03-chat.css`.** `05-squad.css` and `07-cost.css` reuse `spin`/`pulse` from there — don't redefine them.

**`color-mix` for one-off tints.** Where a token blend is needed (selected palette row, accent-tinted strips/chips), the codebase uses `color-mix(in srgb, var(--amber) N%, …)` rather than minting a new variable. Keep the *base* a token so the hue tracks the theme.

**Inline-style caveat.** React inline styles (`style={{ display: … }}`) override class rules — watch `'block'` vs `'flex'` clobbering layout (`CLAUDE.md` Gotchas). Reserve inline style for truly dynamic values (e.g. a bar's `width`).

---

## 10. Do / Don't

**Do**
- Reference **tokens** (`var(--…)`), never raw hex/rgb literals. If you need a tint, `color-mix` from `--amber`/`--accent-rgb` so it tracks the theme.
- Use **`var(--mono)` + `font-variant-numeric: tabular-nums`** for any number, code, or agent output — especially values that update live (timers, costs, token counts, percentages).
- Build icons through **`Icon.tsx`** (24×24, 1.75 stroke, `currentColor`); add a path to `PATHS`.
- Use the **custom form controls** (themed checkbox/select/number) and **`useConfirm()`** instead of native OS widgets / `window.confirm`.
- Fill flex children with **`flex: 1; min-height: 0`** (+ `min-width: 0` for truncation), not `height: 100%`.
- Escalate emphasis by **border/text color** (`--border` → `--amber-dim` → `--amber`/`--amber-bright`), keeping border width at 1px (2px only for accent rails).
- Keep transitions short (`0.12s`) and reuse the shared `spin`/`pulse`/`blink` keyframes.
- Run the **brace-balance grep** after editing any `styles/*.css` partial.

**Don't**
- Don't add **multicolor emoji** to the UI — only the sanctioned brand `⚒` and cost `⛁` glyphs, plus `Icon.tsx` line icons.
- Don't reintroduce **loud orange / saturated accents** — the accent is intentionally a low-chroma warm gray. Keep washes subtle (`0.05–0.16` alpha).
- Don't ship **native OS chrome** (raw `<select>` chevrons, spin buttons, `confirm()` dialogs) — they ignore the theme and break cross-platform consistency.
- Don't use **`height: 100%`** for flex-fill children (Chromium percentage-height fragility).
- Don't edit **`styles.css`** directly — edit the partials, preserving import order.
- Don't leave an **unbalanced brace** in a partial — CSS nesting will silently eat the rest of the file.
- Don't bake **literal colors** into components — and avoid minting new raw-hex semantic colors when `--ok`/`--danger`/`--amber*` already cover the meaning.
