// Lazy senior-dev mode — the portable core of DietrichGebert/ponytail (MIT)
// re-authored from scratch in Forge's own words. Ponytail's idea: before writing
// code, walk a "laziest solution that works" ladder and stop at the first rung
// that satisfies the need — most features want far less code than the model's
// first instinct. "The best code is the code you never wrote."
//
// This module is the SINGLE SOURCE OF TRUTH for that discipline. It is consumed
// two ways, each reusing an existing Forge mechanism rather than porting
// ponytail's own hook/command runtime:
//   1. keywords.ts maps a typed "ponytail"/"lazy mode" → a per-turn directive
//      (lazyDirective), injected as the cache-stable user-message prefix Forge
//      already uses for ralph/ultrathink/… (Composer.tsx). Cache stays warm —
//      strictly better than ponytail's hook that re-injects into the system
//      prompt every turn and busts the prompt cache.
//   2. skillsPack.ts ships LAZY_SKILL / PRUNE_SKILL as one-click EXTEND -> Skills
//      installs; the SDK auto-loads them by description (persistent across a
//      conversation) — Forge's native skill mechanism, no new command system.
//
// Pure: no electron/SDK imports, so it compiles into the selftest core
// (tsconfig.selftest.json) and is exercised headlessly by `npm run selftest`.
// Attribution: ideas adapted from github.com/DietrichGebert/ponytail (MIT).

/** Aggressiveness of the lazy discipline. */
export type LazyLevel = 'lite' | 'full' | 'ultra'

/**
 * The decision ladder: stop at the first rung that works. Ordered cheapest
 * (no code) to most expensive (new code), so the model defaults to deletion.
 */
export const LAZY_LADDER: readonly string[] = [
  'Does this need to exist at all? Prefer not building it (YAGNI) — the cheapest code is the code never written.',
  'Does the standard library already cover it? Use the built-in before anything else.',
  'Is there a native platform/runtime/framework feature for it? Lean on it instead of hand-rolling.',
  'Is it already an installed dependency? Reuse what is on disk before adding code or packages.',
  'Can it be one line (or a few)? Write the minimal expression over a new abstraction.',
  'Only then: write the minimum working code — no speculative layers, no boilerplate.'
]

/** Never trade these away for brevity — laziness is about quantity, not rigor. */
export const LAZY_NON_NEGOTIABLES: readonly string[] = [
  'input validation at trust boundaries',
  'error handling that prevents data loss',
  'security and secrets handling',
  'accessibility',
  'anything the user explicitly asked for'
]

/** Per-level emphasis applied on top of the shared ladder. */
const LEVEL_NOTE: Record<LazyLevel, string> = {
  lite: 'LITE: offer the lazy path as an alternative alongside the normal solution; do not force it.',
  full: 'FULL (default): enforce the ladder — stop at the first rung that works, and justify any rung you skip.',
  ultra:
    'ULTRA: YAGNI extremist — first challenge whether the requirement itself is needed; push back on scope before writing anything.'
}

/**
 * Compact per-turn directive for the magic-keyword prefix. Kept tight because it
 * rides on every matching turn; the model scales to a stated intensity inline.
 */
export function lazyDirective(level: LazyLevel = 'full'): string {
  return [
    'LAZY MODE (ponytail): write the laziest solution that still works. Before writing code, walk this ladder and stop at the first rung that satisfies the need:',
    LAZY_LADDER.map((r, i) => `${i + 1}. ${r}`).join('\n'),
    'Deletion over addition. Boring over clever. Fewest files possible. No unrequested abstractions or dependencies.',
    `Never simplify away: ${LAZY_NON_NEGOTIABLES.join(', ')}.`,
    'Mark intentional shortcuts with a `lazy:` comment naming the ceiling and the upgrade path. Give non-trivial logic one small self-check (an assert or minimal test). After the code, at most three lines on what you skipped and when to expand it.',
    `Intensity if the user qualified it (lite/full/ultra) — ${LEVEL_NOTE[level]} If they say "lite"/"ultra", honor that instead.`
  ].join('\n\n')
}

/** Body for the persistent `lazy` skill installed via EXTEND -> Skills. */
export const LAZY_SKILL_BODY: string = [
  '# Lazy mode — the laziest solution that works',
  '',
  'The best code is the code you never wrote. Most features the model reaches for need far less than its first instinct. Before writing code, walk this ladder and STOP at the first rung that satisfies the need:',
  '',
  ...LAZY_LADDER.map((r, i) => `${i + 1}. ${r}`),
  '',
  '## Principles',
  '',
  '- Deletion over addition. Boring over clever. Fewest files possible.',
  '- No abstraction until there are three real callers. No dependency you can avoid. No boilerplate.',
  '- Prefer a one-liner to a function, a function to a class, a stdlib call to either.',
  '',
  '## Intensity',
  '',
  '- **lite** — show the lazy path as an alternative; let the user choose.',
  '- **full** (default) — enforce the ladder; justify any rung you skip.',
  '- **ultra** — challenge whether the requirement itself is needed before writing anything.',
  '',
  '## Never simplify',
  '',
  `Laziness is about code quantity, never rigor. Keep these in full: ${LAZY_NON_NEGOTIABLES.join(', ')}.`,
  '',
  '## Output',
  '',
  'Mark intentional shortcuts with a `lazy:` comment naming the performance/scale ceiling and the upgrade path. Give non-trivial logic one small self-check (an assertion or a minimal test — no framework needed). After the code, at most three lines on what you skipped and when to expand it.',
  '',
  'Activate on: "ponytail", "lazy mode", "simplest solution", or a complaint about over-engineering. Deactivate on: "stop ponytail" / "normal mode".'
].join('\n')

/** The over-engineering tag taxonomy shared by review (diff) and audit (repo). */
export const PRUNE_TAGS: readonly { tag: string; means: string }[] = [
  { tag: 'delete:', means: 'unused code or speculative feature (no replacement)' },
  { tag: 'stdlib:', means: 'hand-rolled functionality the standard library already provides' },
  { tag: 'native:', means: 'a platform/runtime feature duplicated by custom code or a dependency' },
  { tag: 'yagni:', means: 'a single-implementation abstraction or one-caller layer' },
  { tag: 'shrink:', means: 'the same behavior expressed more concisely' }
]

/** Body for the `prune` skill — over-engineering review (diff) and audit (repo). */
export const PRUNE_SKILL_BODY: string = [
  '# Prune — find what to delete',
  '',
  'A review pass that hunts ONLY for over-engineering: unnecessary complexity, dead code, speculative features, and anything stdlib/native/an-existing-dep already does. This is the complement to a correctness review — it does NOT look for bugs.',
  '',
  '## Scope',
  '',
  '- On a **diff** ("review", `git diff`): judge only the changed lines.',
  '- On the **whole repo** ("audit"): scan everything; rank findings by largest cut first.',
  '- Read-only. Report findings; do not apply fixes unless asked.',
  '',
  '## Tags',
  '',
  ...PRUNE_TAGS.map((t) => `- \`${t.tag}\` ${t.means}`),
  '',
  '## Format',
  '',
  'One finding per line:',
  '',
  '- Diff review: `L<line>: <tag> <what>. <replacement>.`',
  '- Repo audit: `<tag> <what>. <replacement>. [path]` (ranked, biggest cut first).',
  '',
  'Hunt especially for: unused dependencies, single-implementation interfaces, delegating wrappers, modules that export one thing, and hand-rolled versions of standard functions.',
  '',
  '## Conclusion',
  '',
  'End with `net: -<N> lines possible.` If there is nothing to cut, say exactly: `Lean already. Ship.`',
  '',
  'Out of scope (send to a normal review): correctness bugs, security vulnerabilities, performance.'
].join('\n')
