// Eval harness ENTRY (docs/SQUAD_ORCHESTRATION.md §6-8, TOKEN §5).
//
// Default (no session): load + validate the golden set, print its shape. Proves
// the dataset is well-formed and ≥50 — the substrate the kill-criteria gate needs.
//
// LIVE run loop (EVAL_LIVE=1, needs a Claude subscription/API session): for each
// task run (a) ORCHESTRATED (difficulty-routed + cascade escalate-on-fail) and
// (b) a single-agent BASELINE, score each output against its rubric with a cheap
// haiku judge, then call the §8 gate. The scoring/gate functions below mirror the
// TESTED source of truth in src/main/eval.ts (npm run selftest) — re-stated in JS
// so this entry runs standalone via `node scripts/eval.mjs`.
//
// Run:  node scripts/eval.mjs                  # validate only
//       EVAL_LIVE=1 node scripts/eval.mjs      # live loop (subset)
//   EVAL_LIVE=1 EVAL_LIMIT=8 EVAL_BASELINE=sonnet node scripts/eval.mjs

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

// ---------------------------------------------------------------------------
// Scoring + gate — JS mirror of src/main/eval.ts (the tested source of truth).
// ---------------------------------------------------------------------------
const scoreRun = (r) => (r.totalCriteria > 0 ? r.passedCriteria / r.totalCriteria : 0)
function summarize(runs) {
  const tasks = runs.length
  if (tasks === 0) return { tasks: 0, passRate: 0, avgScore: 0, costUsd: 0, tokens: 0 }
  const fullyPassed = runs.filter((r) => scoreRun(r) >= 1).length
  const avgScore = runs.reduce((s, r) => s + scoreRun(r), 0) / tasks
  return {
    tasks,
    passRate: fullyPassed / tasks,
    avgScore,
    costUsd: runs.reduce((s, r) => s + (r.costUsd || 0), 0),
    tokens: runs.reduce((s, r) => s + (r.tokens || 0), 0)
  }
}
function baselineDelta(orchestrated, baseline) {
  const mk = (metric, o, b, betterIfHigher) => ({
    metric, orchestrated: o, baseline: b, delta: o - b, betterIfHigher,
    wins: betterIfHigher ? o > b : o < b
  })
  return [
    mk('passRate', orchestrated.passRate, baseline.passRate, true),
    mk('avgScore', orchestrated.avgScore, baseline.avgScore, true),
    mk('costUsd', orchestrated.costUsd, baseline.costUsd, false),
    mk('tokens', orchestrated.tokens, baseline.tokens, false)
  ]
}
function gateVerdict(deltas) {
  const by = (m) => deltas.find((d) => d.metric === m)
  const qualityWins = !!(by('passRate')?.wins || by('avgScore')?.wins)
  const cost = by('costUsd')
  const tokens = by('tokens')
  const costNotWorse = (cost ? cost.delta <= 0 : true) && (tokens ? tokens.delta <= 0 : true)
  const pass = qualityWins && costNotWorse
  const rationale = pass
    ? 'quality improved at equal-or-less compute → orchestration justified'
    : !qualityWins
      ? 'no quality gain → orchestration not justified'
      : 'quality gained only by spending more compute → not a fair win (§2/§8)'
  return { pass, rationale }
}

// ---------------------------------------------------------------------------
// LIVE run loop.
// ---------------------------------------------------------------------------
async function runLive() {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')

  // Difficulty → tier (mirrors src/main/routing.ts TIER_BY_DIFFICULTY).
  const TIER = { trivial: 'haiku', easy: 'haiku', moderate: 'sonnet', hard: 'opus' }
  const LADDER = ['haiku', 'sonnet', 'opus']
  const escalate = (t) => LADDER[Math.min(LADDER.indexOf(t) + 1, LADDER.length - 1)]
  const baselineModel = process.env.EVAL_BASELINE || 'sonnet'

  // One text-only model call → { text, costUsd, tokens }. Tools are denied (no
  // repo here) so the model answers directly in text; mirrors the known-good
  // src/main/agent/subtaskRunner.ts config. Per-call errors degrade to empty.
  const denyAll = async () => ({ behavior: 'deny', message: 'eval is reasoning-only; no tools' })
  async function call(prompt, model, append) {
    let text = ''
    let costUsd = 0
    let tokens = 0
    try {
      const q = query({
        prompt,
        options: {
          model,
          permissionMode: 'default',
          canUseTool: denyAll,
          maxTurns: 6,
          persistSession: false,
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append:
              'IMPORTANT: there is NO repository or filesystem to inspect. Do NOT call any tool ' +
              '(no Read/Grep/Glob/Bash) — they are all denied and will only waste turns. Answer ' +
              'the task PURELY from its description, immediately, in plain text: a short code ' +
              'sketch plus the key reasoning. You cannot edit files. ' +
              (append || '')
          },
          stderr: () => {}
        }
      })
      for await (const msg of q) {
        if (msg.type === 'assistant')
          for (const b of msg.message?.content ?? []) if (b.type === 'text') text += b.text
        if (msg.type === 'result') {
          costUsd = msg.total_cost_usd ?? 0
          const u = msg.usage || msg.message?.usage || {}
          tokens =
            (u.input_tokens || 0) + (u.output_tokens || 0) +
            (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
        }
      }
    } catch (e) {
      // A turn-cap or transient error → treat as an empty answer (scores 0).
      text = text || ''
    }
    return { text: text.trim(), costUsd, tokens }
  }

  // Haiku rubric judge → { passed, total, costUsd, tokens, lines }.
  async function judge(task, answer) {
    const list = task.rubric.map((c, i) => `${i + 1}. ${c}`).join('\n')
    const prompt =
      `You are a strict grader. A candidate answered a coding task.\n` +
      `TASK: ${task.prompt}\n\nCRITERIA:\n${list}\n\n` +
      `CANDIDATE ANSWER:\n${answer}\n\n---\n` +
      `For EACH criterion output one line "N: PASS" or "N: FAIL" (N = its number). ` +
      `Output only those ${task.rubric.length} lines, nothing else.`
    const r = await call(prompt, 'haiku', 'Be a precise, skeptical grader.')
    let passed = 0
    for (let i = 1; i <= task.rubric.length; i++) {
      const m = r.text.match(new RegExp(`(^|\\n)\\s*${i}\\s*[:.)-]\\s*(PASS|FAIL)`, 'i'))
      if (m && /PASS/i.test(m[2])) passed++
    }
    return { passed, total: task.rubric.length, costUsd: r.costUsd, tokens: r.tokens }
  }

  async function scoreAttempt(task, answer) {
    const j = await judge(task, answer)
    return { passedCriteria: j.passed, totalCriteria: j.total, judgeCost: j.costUsd, judgeTokens: j.tokens }
  }

  // ORCHESTRATED: route by difficulty, then cascade — escalate one tier and retry
  // once if the first attempt doesn't fully pass (target-compute mechanism).
  async function orchestrated(task) {
    let tier = TIER[task.difficulty] || 'sonnet'
    let a = await call(task.prompt, tier)
    let s = await scoreAttempt(task, a.text)
    let cost = a.costUsd + s.judgeCost
    let tokens = a.tokens + s.judgeTokens
    if (s.passedCriteria < s.totalCriteria && tier !== 'opus') {
      tier = escalate(tier)
      const a2 = await call(task.prompt, tier, 'A cheaper attempt missed criteria; be more thorough.')
      const s2 = await scoreAttempt(task, a2.text)
      cost += a2.costUsd + s2.judgeCost
      tokens += a2.tokens + s2.judgeTokens
      if (s2.passedCriteria >= s.passedCriteria) s = s2
    }
    return { id: task.id, passedCriteria: s.passedCriteria, totalCriteria: s.totalCriteria, costUsd: cost, tokens }
  }

  // BASELINE: a single agent at a fixed tier (default sonnet).
  async function baseline(task) {
    const a = await call(task.prompt, baselineModel)
    const s = await scoreAttempt(task, a.text)
    return {
      id: task.id,
      passedCriteria: s.passedCriteria,
      totalCriteria: s.totalCriteria,
      costUsd: a.costUsd + s.judgeCost,
      tokens: a.tokens + s.judgeTokens
    }
  }

  // Subset selection: explicit ids, or a balanced default across difficulties.
  const limit = Number(process.env.EVAL_LIMIT || 5)
  let tasks
  if (process.env.EVAL_TASKS) {
    const want = new Set(process.env.EVAL_TASKS.split(',').map((x) => x.trim()))
    tasks = set.filter((t) => want.has(t.id))
  } else {
    const DEFAULT = ['bug-004', 'algo-003', 'feat-002', 'perf-001', 'bug-003']
    tasks = DEFAULT.map((id) => set.find((t) => t.id === id)).filter(Boolean).slice(0, limit)
    if (tasks.length < limit) tasks = set.slice(0, limit)
  }

  console.log(`\n— LIVE run loop — ${tasks.length} task(s), baseline=${baselineModel} —`)
  const orchRuns = []
  const baseRuns = []
  for (const t of tasks) {
    process.stdout.write(`  [${t.id}/${t.difficulty}] orchestrated… `)
    const o = await orchestrated(t)
    orchRuns.push(o)
    process.stdout.write(`${o.passedCriteria}/${o.totalCriteria} ($${o.costUsd.toFixed(4)})  baseline… `)
    const b = await baseline(t)
    baseRuns.push(b)
    console.log(`${b.passedCriteria}/${b.totalCriteria} ($${b.costUsd.toFixed(4)})`)
  }

  const oSum = summarize(orchRuns)
  const bSum = summarize(baseRuns)
  const deltas = baselineDelta(oSum, bSum)
  const gate = gateVerdict(deltas)

  console.log('\nORCHESTRATED:', JSON.stringify(oSum))
  console.log('BASELINE    :', JSON.stringify(bSum))
  console.log('\nΔ (orchestrated − baseline):')
  for (const d of deltas)
    console.log(
      `  ${d.metric.padEnd(9)} orch=${d.orchestrated.toFixed(4)} base=${d.baseline.toFixed(4)} ` +
        `Δ=${d.delta >= 0 ? '+' : ''}${d.delta.toFixed(4)} ${d.wins ? 'WIN' : '—'}`
    )
  console.log(`\n§8 GATE: ${gate.pass ? 'PASS ✓' : 'FAIL ✗'} — ${gate.rationale}`)
  return gate.pass
}

if (process.env.EVAL_LIVE === '1') {
  runLive()
    .then((pass) => process.exit(problems === 0 && set.length >= 50 && pass ? 0 : 1))
    .catch((e) => {
      console.error('✗ live eval error:', e?.stack || e)
      process.exit(1)
    })
} else {
  console.log('\n— live run loop (set EVAL_LIVE=1 with a Claude session to run it) —')
  console.log('  orchestrated (difficulty-route + cascade) vs single-agent baseline,')
  console.log('  haiku rubric judge, then summarize()/baselineDelta()/gateVerdict().')
  process.exit(problems === 0 && set.length >= 50 ? 0 : 1)
}
