// Unit tests for the pure renderer lib modules (no DOM/Electron/SDK). Compiled by
// tsconfig.test.json → out-test, run via `npm test` (node:test). Mirrors the
// orchestration selftest pattern: a cheap, always-available correctness gate for
// the logic-dense pure helpers that otherwise had zero automated coverage.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conversationToJson, conversationToMarkdown } from '../src/renderer/src/lib/export'
import { reduceBlocks, parseTodos, deriveTasks } from '../src/renderer/src/lib/blocks'
import {
  ctxWindow,
  resolveMaxTurns,
  defaultMaxTurns,
  toolArg,
  cacheHitPercent,
  fmtTokens
} from '../src/renderer/src/lib/format'
import { goalAchieved, goalDirective } from '../src/renderer/src/lib/goal'
import { handleSlashCommand, type SlashCommandContext } from '../src/renderer/src/lib/slashCommands'
import type { AgentEvent, Block, Turn } from '../src/renderer/src/types'

// ── format.ts ──────────────────────────────────────────────────────────────
test('ctxWindow: 1M vs 200k models', () => {
  assert.equal(ctxWindow('haiku'), 200_000)
  assert.equal(ctxWindow('claude-opus-4-8[1m]'), 1_000_000)
  assert.equal(ctxWindow('sonnet'), 1_000_000)
  assert.equal(ctxWindow('claude-opus-4-1'), 200_000)
  assert.equal(ctxWindow(''), 1_000_000)
})

test('resolveMaxTurns: override wins, else per-model default', () => {
  assert.equal(resolveMaxTurns({}, 'haiku'), defaultMaxTurns('haiku'))
  assert.equal(resolveMaxTurns({ 'my-model': 7 }, 'my-model'), 7)
  assert.equal(resolveMaxTurns({ 'my-model': 0 }, 'my-model'), defaultMaxTurns('my-model'))
})

test('toolArg: extracts a label or empty on bad json', () => {
  assert.equal(toolArg('{"file_path":"a.ts"}'), 'a.ts')
  assert.equal(toolArg('{"command":"ls -la"}'), 'ls -la')
  assert.equal(toolArg('not json'), '')
})

test('cacheHitPercent: read / total, null when empty', () => {
  assert.equal(cacheHitPercent(10, 90, 0), 90)
  assert.equal(cacheHitPercent(0, 0, 0), null)
  assert.equal(cacheHitPercent(50, 50, 0), 50)
})

test('fmtTokens: k-suffix over 1000', () => {
  assert.equal(fmtTokens(500), '500')
  assert.equal(fmtTokens(1500), '1.5k')
})

// ── blocks.ts ──────────────────────────────────────────────────────────────
const ev = (e: Partial<AgentEvent> & { type: string }): AgentEvent =>
  ({ runId: 'r', ...e }) as AgentEvent

test('reduceBlocks: text block start + delta accumulates', () => {
  let blocks: Block[] = []
  blocks = reduceBlocks(blocks, ev({ type: 'block-start', blockId: 'b1', kind: 'text' }))
  blocks = reduceBlocks(blocks, ev({ type: 'block-delta', blockId: 'b1', text: 'hel' }))
  blocks = reduceBlocks(blocks, ev({ type: 'block-delta', blockId: 'b1', text: 'lo' }))
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].kind, 'text')
  assert.equal((blocks[0] as Extract<Block, { kind: 'text' }>).text, 'hello')
})

test('reduceBlocks: tool block carries parentToolId, input + result', () => {
  let blocks: Block[] = []
  blocks = reduceBlocks(
    blocks,
    ev({ type: 'block-start', blockId: 'b2', kind: 'tool', name: 'Read', toolId: 't2', parentToolId: 'p1' })
  )
  blocks = reduceBlocks(blocks, ev({ type: 'tool-input', blockId: 'b2', partialJson: '{"file_path":"x"}' }))
  blocks = reduceBlocks(blocks, ev({ type: 'tool-result', toolId: 't2', ok: true, content: 'done' }))
  const b = blocks[0] as Extract<Block, { kind: 'tool' }>
  assert.equal(b.kind, 'tool')
  assert.equal(b.parentToolId, 'p1')
  assert.equal(b.inputRaw, '{"file_path":"x"}')
  assert.equal(b.status, 'ok')
  assert.equal(b.result, 'done')
})

test('reduceBlocks: duplicate block-start is ignored', () => {
  let blocks: Block[] = []
  blocks = reduceBlocks(blocks, ev({ type: 'block-start', blockId: 'b1', kind: 'text' }))
  blocks = reduceBlocks(blocks, ev({ type: 'block-start', blockId: 'b1', kind: 'text' }))
  assert.equal(blocks.length, 1)
})

test('parseTodos: parses todos, normalizes status', () => {
  const todos = parseTodos('{"todos":[{"content":"a","status":"completed"},{"content":"b","status":"weird"}]}')
  assert.ok(todos)
  assert.equal(todos!.length, 2)
  assert.equal(todos![0].status, 'completed')
  assert.equal(todos![1].status, 'pending')
  assert.equal(parseTodos('nope'), null)
})

test('deriveTasks: reconstructs from TaskCreate result', () => {
  const turn: Turn = {
    id: 't',
    prompt: 'p',
    previews: [],
    running: false,
    meta: null,
    blocks: [
      {
        kind: 'tool',
        id: 'b',
        toolId: 'tc',
        name: 'TaskCreate',
        inputRaw: '{"activeForm":"Doing X"}',
        status: 'ok',
        result: 'Task #1 created successfully: Do X'
      }
    ]
  }
  const tasks = deriveTasks([turn])
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].content, 'Do X')
})

// ── export.ts ──────────────────────────────────────────────────────────────
const sampleTurn: Turn = {
  id: 't1',
  prompt: 'do the thing',
  previews: [],
  running: false,
  meta: { costUsd: 0.0123, durationMs: 4200 },
  blocks: [
    { kind: 'text', id: 'x', text: 'done it' },
    { kind: 'tool', id: 'y', toolId: 'ty', name: 'Read', inputRaw: '{"file_path":"a.ts"}', status: 'ok', result: 'contents' }
  ]
}

test('conversationToMarkdown: includes prompts, answers, tools, cost', () => {
  const md = conversationToMarkdown({
    history: [{ kind: 'user', text: 'earlier question' }],
    turns: [sampleTurn]
  })
  assert.match(md, /Claude Forge/)
  assert.match(md, /earlier question/)
  assert.match(md, /do the thing/)
  assert.match(md, /done it/)
  assert.match(md, /\*\*Read\*\*/)
  assert.match(md, /\$0\.0123/)
})

// ── goal.ts ────────────────────────────────────────────────────────────────
test('goalAchieved: last status token wins', () => {
  assert.equal(goalAchieved('working… GOAL_CONTINUE'), false)
  assert.equal(goalAchieved('done. GOAL_ACHIEVED'), true)
  assert.equal(goalAchieved('no token here'), false)
  // ACHIEVED earlier, CONTINUE later → not done.
  assert.equal(goalAchieved('GOAL_ACHIEVED maybe? actually GOAL_CONTINUE'), false)
  // CONTINUE earlier, ACHIEVED later → done.
  assert.equal(goalAchieved('GOAL_CONTINUE … on reflection GOAL_ACHIEVED'), true)
})

test('goalDirective: embeds objective + both status tokens', () => {
  const d = goalDirective('ship the feature')
  assert.match(d, /ship the feature/)
  assert.match(d, /GOAL_ACHIEVED/)
  assert.match(d, /GOAL_CONTINUE/)
})

// ── slashCommands.ts ─────────────────────────────────────────────────────────
function makeCtx(over: Partial<SlashCommandContext> = {}): {
  ctx: SlashCommandContext
  calls: Record<string, unknown[]>
} {
  const calls: Record<string, unknown[]> = {}
  const rec =
    (name: string) =>
    (...a: unknown[]): void => {
      calls[name] = a
    }
  const ctx: SlashCommandContext = {
    models: [{ value: 'claude-opus-4-8', displayName: 'Opus 4.8' }],
    commands: [{ name: 'usage' }],
    running: false,
    setPrompt: rec('setPrompt'),
    pushNotice: rec('pushNotice'),
    onNewSession: rec('onNewSession'),
    showHelp: rec('showHelp'),
    onSetModel: rec('onSetModel'),
    onSetEffort: rec('onSetEffort'),
    onSetPermission: rec('onSetPermission'),
    onSetConvPersona: rec('onSetConvPersona'),
    startGoal: rec('startGoal'),
    ...over
  }
  return { ctx, calls }
}

test('handleSlashCommand: non-slash text is not consumed', () => {
  const { ctx } = makeCtx()
  assert.equal(handleSlashCommand('hello world', ctx), false)
})

test('handleSlashCommand: /clear and /new trigger a new session', () => {
  for (const cmd of ['/clear', '/new']) {
    const { ctx, calls } = makeCtx()
    assert.equal(handleSlashCommand(cmd, ctx), true)
    assert.ok(calls.onNewSession)
  }
})

test('handleSlashCommand: /model sets the conversation model', () => {
  const { ctx, calls } = makeCtx()
  assert.equal(handleSlashCommand('/model claude-opus-4-8', ctx), true)
  assert.deepEqual(calls.onSetModel, ['claude-opus-4-8'])
})

test('handleSlashCommand: /persona clear removes the override', () => {
  const { ctx, calls } = makeCtx({ convPersona: 'be terse' })
  assert.equal(handleSlashCommand('/persona clear', ctx), true)
  assert.deepEqual(calls.onSetConvPersona, [null])
})

test('handleSlashCommand: /goal parses optional max + objective', () => {
  const { ctx, calls } = makeCtx()
  assert.equal(handleSlashCommand('/goal 12 build the thing', ctx), true)
  assert.deepEqual(calls.startGoal, ['build the thing', 12])
})

test('handleSlashCommand: unknown command is consumed with a notice (not sent)', () => {
  const { ctx, calls } = makeCtx()
  assert.equal(handleSlashCommand('/definitelynotacommand', ctx), true)
  assert.ok(calls.pushNotice)
})

test('handleSlashCommand: a real SDK command is NOT consumed (forwarded)', () => {
  const { ctx } = makeCtx()
  assert.equal(handleSlashCommand('/usage', ctx), false)
})

test('conversationToJson: round-trips to a structured object', () => {
  const json = conversationToJson({ history: [], turns: [sampleTurn] })
  const obj = JSON.parse(json) as { app: string; turns: { prompt: string }[] }
  assert.equal(obj.app, 'Claude Forge')
  assert.equal(obj.turns.length, 1)
  assert.equal(obj.turns[0].prompt, 'do the thing')
})

// ── cost.ts ──────────────────────────────────────────────────────────────
import { trendSeries, byConversation, budgetLevel, hasTokens } from '../src/renderer/src/lib/cost'
import type { AgentActivity } from '../src/renderer/src/types'

const run = (p: Partial<AgentActivity>): AgentActivity =>
  ({ id: 'r', kind: 'run', runId: 'r', name: 'main agent', status: 'ok', startedAt: 0, ...p }) as AgentActivity

test('hasTokens: true only when a token field is present', () => {
  assert.equal(hasTokens(run({ inputTokens: 1 })), true)
  assert.equal(hasTokens(run({ cacheReadTokens: 5 })), true)
  assert.equal(hasTokens(run({ costUsd: 0.5 })), false)
})

test('trendSeries: chronological, token-bearing only, capped', () => {
  const entries = [
    run({ startedAt: 30, endedAt: 30, inputTokens: 10, costUsd: 0.3 }),
    run({ startedAt: 10, endedAt: 10, inputTokens: 10, costUsd: 0.1 }),
    run({ startedAt: 20, costUsd: 0.2 }), // no tokens → excluded
  ]
  const s = trendSeries(entries, 40)
  assert.equal(s.length, 2)
  assert.deepEqual(
    s.map((p) => p.t),
    [10, 30]
  )
  const capped = trendSeries(
    Array.from({ length: 50 }, (_, i) => run({ startedAt: i, endedAt: i, inputTokens: 1 })),
    40
  )
  assert.equal(capped.length, 40)
  assert.equal(capped[0].t, 10) // oldest 10 dropped
})

test('byConversation: groups by sessionId, sorted by cost desc', () => {
  const entries = [
    run({ sessionId: 'a', inputTokens: 100, cacheReadTokens: 100, outputTokens: 50, costUsd: 0.2 }),
    run({ sessionId: 'a', inputTokens: 0, cacheReadTokens: 100, costUsd: 0.1 }),
    run({ sessionId: 'b', inputTokens: 10, costUsd: 0.9 }),
    run({ inputTokens: 5, costUsd: 0.05 }), // no sessionId → '' bucket
  ]
  const g = byConversation(entries)
  assert.equal(g.length, 3)
  assert.equal(g[0].sessionId, 'b') // highest cost first
  const a = g.find((c) => c.sessionId === 'a')!
  assert.equal(a.runs, 2)
  assert.ok(Math.abs(a.cost - 0.3) < 1e-9) // cost summed (0.2 + 0.1)
  assert.equal(a.cacheRead, 200)
  // cache hit = read / (fresh+read+write) = 200 / (100+200+0) = 67%
  assert.equal(a.cacheHit, 67)
})

test('budgetLevel: 0 / 80 / 100 thresholds; 0 budget never crosses', () => {
  assert.equal(budgetLevel(5, 0), 0)
  assert.equal(budgetLevel(7, 10), 0)
  assert.equal(budgetLevel(8, 10), 80)
  assert.equal(budgetLevel(9.9, 10), 80)
  assert.equal(budgetLevel(10, 10), 100)
  assert.equal(budgetLevel(12, 10), 100)
})
