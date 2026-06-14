// Eval harness ENTRY (docs/SQUAD_ORCHESTRATION.md §6-8, TOKEN §5).
//
// What runs WITHOUT a live session (now): load + validate the golden set, print
// its shape. This proves the dataset is well-formed and ≥50 — the substrate the
// kill-criteria gate needs.
//
// What needs a live session (TODO, clearly marked below): the actual run loop —
// run each task (a) orchestrated and (b) as a single agent with the SAME token
// budget, score against the rubric, then call gateVerdict (src/main/eval.ts).
// The SCORING/GATE logic is already implemented + headlessly tested (npm run
// selftest); only the model-invocation is missing here.
//
// Run: node scripts/eval.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const setPath = join(here, '..', 'eval', 'golden-set.json')

let set
try {
  set = JSON.parse(readFileSync(setPath, 'utf8'))
} catch (e) {
  console.error('✗ could not read golden set:', e.message)
  process.exit(1)
}

// Lightweight load-time checks (authoritative validation lives in src/main/eval.ts
// and is covered by npm run selftest).
const ids = new Set()
let problems = 0
for (const t of set) {
  if (!t.id || ids.has(t.id)) problems++
  else ids.add(t.id)
  if (!t.prompt || !Array.isArray(t.rubric) || t.rubric.length === 0) problems++
}

const byCat = {}
const byDiff = {}
for (const t of set) {
  byCat[t.category] = (byCat[t.category] || 0) + 1
  byDiff[t.difficulty] = (byDiff[t.difficulty] || 0) + 1
}

console.log(`golden set: ${set.length} tasks (need ≥50: ${set.length >= 50 ? 'OK' : 'SHORT'})`)
console.log('by difficulty:', byDiff)
console.log('by category  :', byCat)
console.log(problems === 0 ? '✓ structural checks passed' : `✗ ${problems} structural problems`)

console.log('\n— live run loop (needs a Claude subscription/API session) —')
console.log('TODO: for each task → run orchestrated + single-baseline at equal budget,')
console.log('      score vs rubric, then summarize()/baselineDelta()/gateVerdict() from')
console.log('      src/main/eval.ts. Scoring + gate are implemented and tested today.')

process.exit(problems === 0 && set.length >= 50 ? 0 : 1)
