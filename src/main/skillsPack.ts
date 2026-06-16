// Curated starter skill pack — the portable value of mattpocock/skills (MIT):
// small, composable, model-agnostic engineering skills that target the common
// failure modes of AI coding (misalignment, verbosity, broken code, weak
// debugging). Re-authored from scratch in Forge's own words (MIT permits copying;
// we rewrite to fit and to be safe) and shipped as one-click installs into the
// EXTEND -> Skills console (.claude/skills/<name>/SKILL.md), where the SDK
// auto-loads them by description. Attribution: ideas adapted from
// github.com/mattpocock/skills (MIT). Efficiency angle: `caveman` directly cuts
// output tokens; `grill` cuts wasted turns from misalignment.

import { listSkills, writeSkill, type SkillMeta } from './skills'
import { LAZY_SKILL_BODY, PRUNE_SKILL_BODY } from './lazy'

export interface BundledSkill {
  name: string
  description: string
  body: string
}

export interface BundledSkillStatus extends BundledSkill {
  installed: boolean
}

export type InstallBundledResult =
  | { ok: true; skills: SkillMeta[]; alreadyInstalled: boolean }
  | { ok: false; error: string }

export const SKILLS_PACK: BundledSkill[] = [
  {
    name: 'caveman',
    description:
      'Token-efficient communication mode. Reply in maximally compressed English to cut output tokens ~75% without losing information. Use when the user asks to be terse, save tokens, or says "caveman".',
    body: [
      '# Caveman mode — say more with fewer tokens',
      '',
      'When active, write all PROSE in maximally compressed English:',
      '',
      '- Drop articles (a/an/the), most pronouns, and filler ("I will now", "let me", "it looks like").',
      '- Prefer fragments, lists, and symbols (→ & + vs.) over full sentences.',
      '- One idea per line. No preamble, no recap of what the user already said.',
      '- Lead with the answer; cut hedging and apologies.',
      '',
      '## Never compress',
      '',
      'Keep these byte-exact — compression here causes bugs:',
      '',
      '- Code blocks, identifiers, file paths, shell commands, URLs.',
      '- Numbers, error messages, and anything quoted from the user or the codebase.',
      '',
      'Goal: identical information, far fewer tokens. If compression would lose meaning, keep the words.'
    ].join('\n')
  },
  {
    name: 'grill',
    description:
      'Alignment interview. Before building anything non-trivial, interrogate the request to surface hidden requirements, then restate the agreed spec. Use when a task is ambiguous or the cost of building the wrong thing is high.',
    body: [
      '# Grill — align before you build',
      '',
      'Misalignment is the most expensive failure: a confidently-built wrong thing wastes a whole loop. Spend a few cheap turns up front.',
      '',
      '## Procedure',
      '',
      '1. Read the request and list every assumption you would have to make to start coding.',
      '2. Ask focused questions — one topic at a time — covering: scope & non-goals, inputs/outputs, edge cases, constraints (perf, deps, style), and the definition of done.',
      '3. Keep asking until you can restate the task with no remaining assumptions.',
      '4. Write back a short **agreed spec** (3–8 bullets) and get a yes before implementing.',
      '',
      'Stop early if the task is genuinely trivial — this is for ambiguous or high-stakes work, not one-line fixes.'
    ].join('\n')
  },
  {
    name: 'tdd',
    description:
      'Test-driven development loop (red → green → refactor). Use when implementing a feature or fixing a bug where behavior can be expressed as a test, to get a tight feedback loop instead of guessing.',
    body: [
      '# TDD — red, green, refactor',
      '',
      'A feedback loop beats a guess. Let a failing test define "done", then make it pass.',
      '',
      '## Loop',
      '',
      '1. **Red** — write the smallest failing test that captures the next slice of behavior. Run it; confirm it fails for the right reason.',
      '2. **Green** — write the minimum code to make it pass. No extra abstraction.',
      '3. **Refactor** — clean up with the test green as a safety net.',
      '4. Repeat for the next slice.',
      '',
      'Run the test command after every step — never claim a test passes without running it. If a test is hard to write, that is a signal the design is off; simplify the interface first.'
    ].join('\n')
  },
  {
    name: 'diagnose',
    description:
      'Structured debugging loop for a reported bug or failing test. Use instead of guessing fixes — reproduce, minimize, hypothesize, instrument, fix, verify.',
    body: [
      '# Diagnose — debug by method, not by guess',
      '',
      'Random edits make bugs worse. Follow the loop until the root cause is proven.',
      '',
      '## Loop',
      '',
      '1. **Reproduce** — get a reliable, minimal repro. If you cannot reproduce it, you cannot fix it.',
      '2. **Minimize** — strip the repro to the smallest input/code that still fails.',
      '3. **Hypothesize** — state one specific, falsifiable cause.',
      '4. **Instrument** — add logging/asserts to confirm or kill the hypothesis. Let evidence decide, not intuition.',
      '5. **Fix** — change the one thing the evidence points to.',
      '6. **Verify** — the repro now passes AND the broader test suite is still green. Remove temporary instrumentation.',
      '',
      'Report the root cause in one sentence before the fix — if you cannot, you have not finished step 3.'
    ].join('\n')
  },
  {
    name: 'lazy',
    description:
      'Lazy senior-dev mode (ponytail). Before writing code, walk a "laziest solution that works" ladder — YAGNI, stdlib, native feature, existing dep, one-liner — and stop at the first rung. Use when the user wants minimal code, says "ponytail"/"lazy mode", or complains about over-engineering. Cuts generated code without compromising security, validation, or accessibility.',
    body: LAZY_SKILL_BODY
  },
  {
    name: 'prune',
    description:
      'Over-engineering review/audit. Scan a diff or the whole repo ONLY for complexity to delete — dead code, speculative features, hand-rolled stdlib, single-caller abstractions — with tagged findings and a net-lines-cut count. Use for "review for over-engineering", "what can we delete", or a simplification audit. Does not look for bugs; pair it with a correctness review.',
    body: PRUNE_SKILL_BODY
  },
  {
    name: 'handoff',
    description:
      'Write a concise handoff summary of the current work so a fresh session (or teammate) can resume without re-deriving context. Use at the end of a long session or before a context reset.',
    body: [
      '# Handoff — leave the next session a map',
      '',
      'Context is expensive to rebuild. Before ending a long session, write a handoff so the next run starts informed.',
      '',
      '## Format',
      '',
      '- **Goal** — what we are trying to achieve, in one line.',
      '- **Done** — what changed this session (files, decisions), with reasons.',
      '- **State** — what currently works and what does not (with evidence: tests run, output).',
      '- **Next** — the concrete next steps, ordered.',
      '- **Open questions** — anything blocked on a decision or unknown.',
      '',
      'Be specific and honest: name files and commands, and do not claim something works if you have not verified it.'
    ].join('\n')
  }
]

/** The pack, each annotated with whether a skill of that name already exists. */
export async function listBundledSkills(): Promise<BundledSkillStatus[]> {
  let installed: SkillMeta[]
  try {
    installed = await listSkills()
  } catch {
    installed = []
  }
  const have = new Set(installed.map((s) => s.name))
  return SKILLS_PACK.map((s) => ({ ...s, installed: have.has(s.name) }))
}

/**
 * Install one bundled skill into `.claude/skills/`. Idempotent: if a skill of
 * that name already exists, leave it untouched (never clobber a user edit) and
 * report alreadyInstalled.
 */
export async function installBundledSkill(name: string): Promise<InstallBundledResult> {
  const skill = SKILLS_PACK.find((s) => s.name === name)
  if (!skill) return { ok: false, error: `Unknown bundled skill "${name}".` }
  const existing = await listSkills().catch(() => [] as SkillMeta[])
  if (existing.some((s) => s.name === name)) {
    return { ok: true, skills: existing, alreadyInstalled: true }
  }
  const res = await writeSkill({ name: skill.name, description: skill.description, body: skill.body })
  if (!res.ok) return res
  return { ok: true, skills: res.skills, alreadyInstalled: false }
}
