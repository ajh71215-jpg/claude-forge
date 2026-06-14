// Headless self-test for the validated orchestration core (docs/
// SQUAD_ORCHESTRATION.md, TOKEN_OPTIMIZATION.md). Model calls are injected as
// stubs, so the DETERMINISTIC LOGIC — DAG execution order, verify→revise cascade,
// budget hard-cap, plan-validation gate, judge-bias-mitigated voting — is
// exercised for real without a live session. This is the part that does NOT need
// the live golden-set eval to be correct; the eval tunes thresholds, this proves
// the mechanism.
//
// Run: npm run selftest  (compiles tsconfig.selftest.json → out-selftest, then this)

const assert = require('node:assert')
const path = require('node:path')
const base = path.join(__dirname, '..', 'out-selftest')

const { topoSort } = require(path.join(base, 'orchestration.js'))
const { validatePlan, executePlan, projectPlanCost } = require(path.join(base, 'conductor.js'))
const { route, classifyDifficulty, escalate, resolveModelId } = require(path.join(base, 'routing.js'))
const { aggregateVotes, shouldEarlyStop, pairwiseWithSwap, debateConverged } = require(
  path.join(base, 'verifier.js')
)
const { runChecks, checksToVerdict } = require(path.join(base, 'toolVerifier.js'))
const { executeTopology } = require(path.join(base, 'topology.js'))
const { getRole, isRole, ROLE_NAMES, listRoles } = require(path.join(base, 'roles.js'))
const { runLoop } = require(path.join(base, 'loop.js'))
const { validateGoldenSet, summarize, baselineDelta, gateVerdict } = require(path.join(base, 'eval.js'))
const goldenSet = require(path.join(__dirname, '..', 'eval', 'golden-set.json'))

let passed = 0
const groups = []
function group(name) {
  groups.push(name)
  console.log('\n' + name)
}
function check(name, cond) {
  assert.ok(cond, name)
  console.log('  ✓ ' + name)
  passed++
}

// ---- helpers ----
const verdict = (id, pass) => ({
  subtaskId: id,
  pass,
  score: pass ? 1 : 0,
  confidence: 1,
  rationale: 't',
  evidence: []
})
const sub = (id, over = {}) => ({
  id,
  instruction: 'do ' + id,
  topology: 'single',
  model: 'cascade',
  tools: [],
  rubric: 'works',
  ...over
})

async function main() {
  // ============ ROUTING (cascade + difficulty) ============
  group('routing.ts — difficulty routing + cascade ladder')
  check('trivial → haiku', classifyDifficulty('rename foo to bar') === 'trivial')
  check('hard → opus', classifyDifficulty('refactor auth module for a race condition') === 'hard')
  check('route trivial = haiku/low', (() => {
    const r = route({ instruction: 'fix a typo' })
    return r.tier === 'haiku' && r.effort === 'low'
  })())
  check('route hard = opus/high', (() => {
    const r = route({ instruction: 'design a distributed consensus algorithm' })
    return r.tier === 'opus' && r.effort === 'high'
  })())
  check('explicit plan tier wins', route({ instruction: 'anything', tier: 'sonnet' }).tier === 'sonnet')
  check('escalate ladder caps at opus', escalate('haiku') === 'sonnet' && escalate('opus') === 'opus')
  check('priorFailures walks ladder haiku→opus', route({ instruction: 'fix a typo', priorFailures: 2 }).tier === 'opus')
  check('resolveModelId matches live id', resolveModelId('opus', [{ value: 'claude-opus-4-6' }]) === 'claude-opus-4-6')
  check('resolveModelId falls back to alias', resolveModelId('haiku', []) === 'haiku')

  // ============ VERIFIER (debate / voting / bias) ============
  group('verifier.ts — voting, early-stop, order-swap, debate')
  check('majority pass (2>1)', aggregateVotes([verdict('x', true), verdict('x', true), verdict('x', false)]).pass)
  check('tie resolves to FAIL', !aggregateVotes([
    { pass: true, score: 1, confidence: 1 },
    { pass: false, score: 0, confidence: 1 }
  ]).pass)
  check('confidence weighting can flip a count-tie', (() => {
    const votes = [
      { pass: true, score: 1, confidence: 0.9 },
      { pass: false, score: 0, confidence: 0.2 }
    ]
    return aggregateVotes(votes, 'majority').pass === false && aggregateVotes(votes, 'confidence').pass === true
  })())
  check('early-stop on convergence', shouldEarlyStop([verdict('x', true), verdict('x', true), verdict('x', true)]))
  check('no early-stop when split', !shouldEarlyStop([verdict('x', true), verdict('x', true), verdict('x', false)]))
  check('no early-stop below minVotes', !shouldEarlyStop([verdict('x', true), verdict('x', true)]))
  check('debate converges on agreement', debateConverged([true, true]) && !debateConverged([true, false]))
  check('debate caps at maxRounds', debateConverged([true, false, true]))

  // consistent judge → decisive; position-biased judge → tie
  const consistentJudge = async (x) => (x === 'A' ? 'a' : 'b')
  const biasedJudge = async () => 'a' // always prefers first slot
  check('order-swap: consistent judge decides', (await pairwiseWithSwap(consistentJudge, 'A', 'B')) === 'a')
  check('order-swap: position-biased judge → tie', (await pairwiseWithSwap(biasedJudge, 'A', 'B')) === 'tie')

  // ============ ORCHESTRATION GRAPH ============
  group('orchestration.ts — topological DAG')
  check('linear order A→B→C', (() => {
    const plan = { goal: 'g', budgetUsd: 10, subtasks: [sub('A'), sub('B'), sub('C')], edges: [['A', 'B'], ['B', 'C']] }
    const { order, cycle } = topoSort(plan)
    return !cycle && order.indexOf('A') < order.indexOf('B') && order.indexOf('B') < order.indexOf('C')
  })())
  check('cycle detected', topoSort({ goal: 'g', budgetUsd: 10, subtasks: [sub('A'), sub('B')], edges: [['A', 'B'], ['B', 'A']] }).cycle)

  // ============ CONDUCTOR (plan gate + deterministic execution) ============
  group('conductor.ts — validation gate')
  check('valid plan passes gate', validatePlan({ goal: 'g', budgetUsd: 5, subtasks: [sub('A')], edges: [] }).ok)
  check('rejects empty rubric', !validatePlan({ goal: 'g', budgetUsd: 5, subtasks: [sub('A', { rubric: '' })], edges: [] }).ok)
  check('rejects bad tier', !validatePlan({ goal: 'g', budgetUsd: 5, subtasks: [sub('A', { model: 'gpt' })], edges: [] }).ok)
  check('rejects zero budget', !validatePlan({ goal: 'g', budgetUsd: 0, subtasks: [sub('A')], edges: [] }).ok)
  check('rejects duplicate ids', !validatePlan({ goal: 'g', budgetUsd: 5, subtasks: [sub('A'), sub('A')], edges: [] }).ok)
  check('rejects dangling edge', !validatePlan({ goal: 'g', budgetUsd: 5, subtasks: [sub('A')], edges: [['A', 'Z']] }).ok)
  check('rejects cyclic plan', !validatePlan({ goal: 'g', budgetUsd: 5, subtasks: [sub('A'), sub('B')], edges: [['A', 'B'], ['B', 'A']] }).ok)

  group('conductor.ts — deterministic execution')
  // happy path: A→B, both pass, costs accrue, order honored
  {
    const seen = []
    const plan = { goal: 'g', budgetUsd: 10, subtasks: [sub('A'), sub('B')], edges: [['A', 'B']] }
    const res = await executePlan(plan, {
      runSubtask: async (st) => {
        seen.push(st.id)
        return { subtaskId: st.id, output: 'o', costUsd: 1 }
      },
      verify: async (st) => verdict(st.id, true)
    })
    check('happy path runs both', res.artifacts.length === 2)
    check('happy path spent = 2', res.spentUsd === 2)
    check('happy path honored A before B', seen[0] === 'A' && seen[1] === 'B')
    check('happy path not stopped', !res.stopped)
  }

  // verify→revise cascade: fail attempt 0, escalate, pass attempt 1
  {
    const tiersTried = []
    const plan = { goal: 'g', budgetUsd: 10, subtasks: [sub('A')], edges: [] }
    const res = await executePlan(plan, {
      maxRevisions: 1,
      runSubtask: async (st, attempt) => {
        // cascade: tier escalates with attempt (validated escalate-on-failure)
        tiersTried.push(route({ instruction: st.instruction, priorFailures: attempt }).tier)
        return { subtaskId: st.id, output: 'o', costUsd: 1 }
      },
      verify: async (st, _art) => verdict(st.id, tiersTried.length >= 2) // fail first, pass second
    })
    check('revise retried once', tiersTried.length === 2)
    check('revise escalated the tier', tiersTried[1] !== tiersTried[0])
    check('revise eventually passed', res.artifacts[0].verdict.pass === true)
  }

  // budget governor: hard-cap halts before overspend
  {
    const plan = { goal: 'g', budgetUsd: 1.5, subtasks: [sub('A'), sub('B')], edges: [['A', 'B']] }
    const res = await executePlan(plan, {
      projectCostUsd: () => 1,
      runSubtask: async (st) => ({ subtaskId: st.id, output: 'o', costUsd: 1 }),
      verify: async (st) => verdict(st.id, true)
    })
    check('budget cap stopped run', res.stopped === 'budget')
    check('budget cap ran only A', res.artifacts.length === 1 && res.spentUsd === 1)
  }

  // invalid plan short-circuits
  {
    const res = await executePlan({ goal: '', budgetUsd: 0, subtasks: [], edges: [] }, {
      runSubtask: async () => { throw new Error('should not run') },
      verify: async () => { throw new Error('should not run') }
    })
    check('invalid plan stopped without running', res.stopped === 'invalid-plan' && res.artifacts.length === 0)
  }

  check('projectPlanCost sums subtasks', projectPlanCost({ goal: 'g', budgetUsd: 9, subtasks: [sub('A'), sub('B'), sub('C')], edges: [] }, () => 2) === 6)

  // ============ ① TOOL-BASED VERIFIER (objective oracle, no model) ============
  group('toolVerifier.ts — tool oracle verdicts')
  {
    const okRunner = async () => ({ code: 0, output: 'ok' })
    const failRunner = async (cmd) => ({ code: cmd.includes('test') ? 1 : 0, output: 'x' })
    const throwRunner = async () => { throw new Error('boom') }
    const checks = [{ name: 'typecheck', command: 'tsc' }, { name: 'test', command: 'npm test' }]

    const allOk = await runChecks(checks, okRunner)
    check('all checks pass → verdict.pass', checksToVerdict('A', allOk).pass === true)
    check('verdict confidence is 1 (oracle)', checksToVerdict('A', allOk).confidence === 1)

    const oneFail = await runChecks(checks, failRunner)
    const v = checksToVerdict('A', oneFail)
    check('one fail → verdict.fail', v.pass === false)
    check('partial score reflects pass ratio', v.score === 0.5)
    check('rationale names failed check', v.rationale.includes('test'))

    const threw = await runChecks([{ name: 'x', command: 'z' }], throwRunner)
    check('thrown runner → failed result', threw[0].ok === false)
  }

  // ============ ② TOPOLOGY EXECUTORS (over injected runner/verifier) ============
  group('topology.ts — fanout / self-consistency / debate / cascade')
  const mkArt = (id, output, cost = 1) => ({ subtaskId: id, output, costUsd: cost })
  {
    // single
    const r1 = await executeTopology(sub('A', { topology: 'single' }), {
      run: async (st) => mkArt(st.id, 'one'),
      verify: async (st) => verdict(st.id, true)
    })
    check('single → 1 sample', r1.samples.length === 1)

    // fanout: verifier-selected best-of-N (score = sample index)
    const r2 = await executeTopology(sub('A', { topology: 'fanout', n: 3 }), {
      run: async (st, ctx) => mkArt(st.id, 'cand' + ctx.sample),
      verify: async (st, art) => ({ ...verdict(st.id, true), score: Number(art.output.replace('cand', '')) })
    })
    check('fanout ran n samples', r2.samples.length === 3)
    check('fanout picked highest-scoring (verifier-selected)', r2.artifact.output === 'cand2')

    // self-consistency: early-stop once 3 agree even with n=5
    const r3 = await executeTopology(sub('A', { topology: 'self_consistency', n: 5 }), {
      run: async (st, ctx) => mkArt(st.id, 's' + ctx.sample),
      verify: async (st) => verdict(st.id, true)
    })
    check('self-consistency early-stopped at 3', r3.samples.length === 3)
    check('self-consistency verdict passes (consensus)', r3.verdict.pass === true)

    // debate: converges when last two rounds agree (all pass → 2 rounds)
    const r4 = await executeTopology(sub('A', { topology: 'debate' }), {
      run: async (st, ctx) => mkArt(st.id, 'd' + ctx.sample),
      verify: async (st) => verdict(st.id, true)
    })
    check('debate converged in 2 rounds', r4.samples.length === 2)

    // cascade: starts cheap (trivial instruction → haiku) and fails until it
    // escalates to opus — proves external failure drives tier escalation.
    const r5 = await executeTopology(sub('A', { topology: 'cascade', instruction: 'rename a variable' }), {
      run: async (st, ctx) => mkArt(st.id, ctx.tier),
      verify: async (st, art) => verdict(st.id, art.output === 'opus')
    })
    check('cascade escalated to opus and passed', r5.verdict.pass === true && r5.artifact.output === 'opus')
    check('cascade tried multiple tiers', new Set(r5.samples.map((s) => s.output)).size >= 2)
  }

  // ============ ROLES (native oh-my-claudecode agent port) ============
  group('roles.ts — agent-role registry')
  check('all 19 OMC roles present', ROLE_NAMES.length === 19)
  check('executor is a builder (write-capable)', getRole('executor').writeCapable === true)
  check('architect is read-only advisor', getRole('architect').writeCapable === false)
  check('role lookup is case-insensitive', getRole('Executor').name === 'executor')
  check('unknown role rejected', isRole('not-a-role') === false && getRole('not-a-role') === undefined)
  check('explore defaults to haiku tier', getRole('explore').tier === 'haiku')
  check('every role has a non-empty systemAppend', listRoles().every((r) => r.systemAppend.trim().length > 0))
  check('validatePlan accepts a known role', validatePlan({ goal: 'g', budgetUsd: 5, subtasks: [sub('A', { role: 'executor' })], edges: [] }).ok)
  check('validatePlan rejects an unknown role', !validatePlan({ goal: 'g', budgetUsd: 5, subtasks: [sub('A', { role: 'wizard' })], edges: [] }).ok)
  check('role tier routes the model on cascade', route({ instruction: 'fix a typo', roleTier: 'opus' }).tier === 'opus')
  check('explicit plan tier outranks role tier', route({ instruction: 'x', tier: 'haiku', roleTier: 'opus' }).tier === 'haiku')

  // ============ LOOP (native ralph/autopilot — loop until verified) ============
  group('loop.ts — autonomous loop until goal verified')
  {
    // converges on iteration 1 when everything passes first try
    const plan1 = { goal: 'g', budgetUsd: 10, subtasks: [sub('A'), sub('B')], edges: [['A', 'B']] }
    const r1 = await runLoop(plan1, {
      runSubtask: async (st) => ({ subtaskId: st.id, output: 'o', costUsd: 1 }),
      verify: async (st) => verdict(st.id, true)
    }, { maxIterations: 3 })
    check('loop converges in 1 iteration when all pass', r1.iterations === 1 && r1.goalPass === true)

    // a subtask fails until iteration 2, then passes → loop persists
    {
      const runsById = {}
      const plan2 = { goal: 'g', budgetUsd: 50, subtasks: [sub('A'), sub('B')], edges: [] }
      const r2 = await runLoop(plan2, {
        runSubtask: async (st) => { runsById[st.id] = (runsById[st.id] ?? 0) + 1; return { subtaskId: st.id, output: 'o', costUsd: 1 } },
        // A always passes; B passes only once it has been ATTEMPTED twice across iterations
        verify: async (st) => verdict(st.id, st.id === 'A' ? true : runsById['B'] >= 2)
      }, { maxIterations: 4, maxRevisions: 0 })
      check('loop persists across iterations until goal passes', r2.goalPass === true && r2.iterations >= 2)
      check('loop caches passed subtask A (run once)', runsById['A'] === 1)
    }

    // never passes → stops at max-iterations, not infinitely
    const r3 = await runLoop({ goal: 'g', budgetUsd: 100, subtasks: [sub('A')], edges: [] }, {
      runSubtask: async (st) => ({ subtaskId: st.id, output: 'o', costUsd: 1 }),
      verify: async (st) => verdict(st.id, false)
    }, { maxIterations: 2, maxRevisions: 0 })
    check('loop stops at max-iterations when never verified', r3.stopped === 'max-iterations' && r3.iterations === 2 && !r3.goalPass)

    // global budget hard-stops the loop
    const r4 = await runLoop({ goal: 'g', budgetUsd: 1.5, subtasks: [sub('A')], edges: [] }, {
      projectCostUsd: () => 1,
      runSubtask: async (st) => ({ subtaskId: st.id, output: 'o', costUsd: 1 }),
      verify: async (st) => verdict(st.id, false)
    }, { maxIterations: 9 })
    check('loop halts on global budget cap', r4.stopped === 'budget')

    // invalid plan short-circuits without running
    const r5 = await runLoop({ goal: '', budgetUsd: 0, subtasks: [], edges: [] }, {
      runSubtask: async () => { throw new Error('should not run') },
      verify: async () => { throw new Error('should not run') }
    })
    check('loop rejects invalid plan without running', r5.stopped === 'invalid-plan' && r5.iterations === 0)
  }

  // ============ ③ EVAL CORE + REAL GOLDEN SET ============
  group('eval.ts — golden set + scoring + kill-criteria gate')
  check('authored golden set is valid (≥50)', validateGoldenSet(goldenSet).ok === true)
  check('golden set has ≥50 tasks', goldenSet.length >= 50)
  check('validate rejects tiny set', validateGoldenSet([{ id: 'x', category: 'c', difficulty: 'easy', prompt: 'p', rubric: ['r'] }]).ok === false)
  {
    const orch = summarize([
      { id: 'a', passedCriteria: 3, totalCriteria: 3, costUsd: 1, tokens: 100 },
      { id: 'b', passedCriteria: 2, totalCriteria: 3, costUsd: 1, tokens: 100 }
    ])
    check('summarize passRate counts full passes', orch.passRate === 0.5)
    // gate: quality up AND compute not higher → pass
    const base = { tasks: 2, passRate: 0.3, avgScore: 0.6, costUsd: 2.5, tokens: 300 }
    const winDeltas = baselineDelta(orch, base)
    check('gate passes: better quality at less compute', gateVerdict(winDeltas).pass === true)
    // gate: quality up but spent MORE compute than baseline → not a fair win (§8)
    const cheaperBaseline = { tasks: 2, passRate: 0.3, avgScore: 0.6, costUsd: 1, tokens: 100 }
    const overspendDeltas = baselineDelta(orch, cheaperBaseline)
    check('gate fails: quality won only by overspending', gateVerdict(overspendDeltas).pass === false)
  }

  console.log('\n✓ ' + passed + ' checks passed across ' + groups.length + ' modules')
}

main().catch((e) => {
  console.error('\n✗ SELFTEST FAILED:', e.message)
  process.exit(1)
})
