// Unit tests for the pure efficiency cores absorbed from headroom (compression)
// and agentmemory (memory retrieval). No DOM/Electron/SDK — compiled by
// tsconfig.test.json → out-test, run via `npm test` (node:test). Same cheap,
// always-available gate as the orchestration selftest and the renderer-lib tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateTokens,
  compressText,
  compressContext,
  capToolResult,
  squeezeProse,
  FORGE_CONTEXT_TOKEN_CAP
} from '../src/main/efficiency/compress'
import { maskObservations } from '../src/main/efficiency/mask'
import { createResponseCache } from '../src/main/efficiency/responseCache'

// ── compress.ts (headroom) ───────────────────────────────────────────────────
test('estimateTokens: ~4 chars/token', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('a'.repeat(401)), 101)
})

test('compressText: collapses blank-line runs', () => {
  const r = compressText('a\n\n\n\n\nb')
  assert.equal(r.text, 'a\n\nb')
  assert.ok(r.compressedChars < r.originalChars)
})

test('compressText: dedups long repeated adjacent lines', () => {
  const line = 'ERROR connection refused'
  const r = compressText([line, line, line, line, 'ok'].join('\n'))
  assert.match(r.text, /\(×4\)/)
  assert.ok(r.text.includes('ok'))
})

test('compressText: does NOT dedup short lines (braces, blanks)', () => {
  const r = compressText('}\n}\n}\n}', { collapseBlankLines: false })
  assert.ok(!/×/.test(r.text), 'short lines must stay intact')
})

test('compressText: JSON is clipped and minified', () => {
  const big = JSON.stringify({ s: 'x'.repeat(1000), arr: Array.from({ length: 100 }, (_, i) => i) })
  const r = compressText(big, { maxJsonString: 50, maxJsonArray: 5 })
  assert.ok(r.compressedTokens < r.originalTokens)
  assert.match(r.text, /\+950 chars/)
  assert.match(r.text, /\+95 more items/)
})

test('compressText: maxTokens cap forces marked head/tail elision', () => {
  const text = Array.from({ length: 400 }, (_, i) => `line ${i} ${'.'.repeat(20)}`).join('\n')
  const r = compressText(text, { maxTokens: 100 })
  assert.ok(r.truncated)
  assert.ok(r.compressedTokens <= 120, `expected ~<=100 tokens, got ${r.compressedTokens}`)
  assert.match(r.text, /elided by Forge compression/)
  assert.ok(r.text.includes('line 0'), 'keeps head')
  assert.ok(r.text.includes('line 399'), 'keeps tail')
})

test('compressText: ratio reports fraction removed', () => {
  const r = compressText('x\n\n\n\n\n\n\n\ny')
  assert.ok(r.ratio > 0 && r.ratio <= 1)
})

test('compressText: empty input is safe', () => {
  const r = compressText('')
  assert.equal(r.text, '')
  assert.equal(r.ratio, 0)
})

test('compressContext: labels parts and stays within budget', () => {
  const parts = [
    { label: 'memory', text: Array.from({ length: 200 }, (_, i) => `mem fact ${i}`).join('\n') },
    { label: 'repo map', text: Array.from({ length: 200 }, (_, i) => `src/file${i}.ts`).join('\n') }
  ]
  const r = compressContext(parts, 80)
  assert.match(r.text, /## memory/)
  assert.match(r.text, /## repo map/)
  assert.ok(r.compressedTokens <= 160, `over budget: ${r.compressedTokens}`)
})

test('compressContext: drops empty parts', () => {
  const r = compressContext([{ label: 'a', text: '' }, { label: 'b', text: 'hi' }], 0)
  assert.ok(!r.text.includes('## a'))
  assert.match(r.text, /## b/)
})

// ── capToolResult (Forge-owned tool-result / context cap) ────────────────────
test('capToolResult: under cap passes through without a trim header', () => {
  const r = capToolResult('short answer', undefined, 'delegated result')
  assert.equal(r.truncated, false)
  assert.equal(r.text, 'short answer')
  assert.ok(!/Forge trimmed/.test(r.text))
})

test('capToolResult: over cap elides and prepends a self-describing header', () => {
  const huge = Array.from({ length: 5000 }, (_, i) => `detail line ${i} ${'.'.repeat(30)}`).join('\n')
  const r = capToolResult(huge, 200, 'delegated result')
  assert.ok(r.truncated)
  assert.ok(r.originalTokens > r.tokens, 'should shrink')
  assert.ok(r.tokens <= 260, `expected ~<=200 tokens, got ${r.tokens}`)
  assert.match(r.text, /Forge trimmed this delegated result/)
  assert.match(r.text, /elided by Forge compression/)
})

test('capToolResult: default cap is the shared 8k constant', () => {
  assert.equal(FORGE_CONTEXT_TOKEN_CAP, 8000)
  // A blob just under the cap is not truncated at the default.
  const justUnder = 'x'.repeat((FORGE_CONTEXT_TOKEN_CAP - 100) * 4)
  assert.equal(capToolResult(justUnder).truncated, false)
})

test('capToolResult: empty input is safe', () => {
  const r = capToolResult('')
  assert.equal(r.text, '')
  assert.equal(r.truncated, false)
})

// ── squeezeProse (model-free LLMLingua analog) ───────────────────────────────
test('squeezeProse: drops filler phrases and tightens whitespace', () => {
  const r = squeezeProse('Please note that in order to  build , you basically run it .')
  assert.ok(!/please note that/i.test(r))
  assert.ok(!/basically/i.test(r))
  assert.match(r, /\bto build,/)
  assert.ok(!/ {2,}/.test(r), 'collapses double spaces')
  assert.ok(!/ ,/.test(r), 'no space before punctuation')
})

test('squeezeProse: leaves clean prose essentially intact', () => {
  assert.equal(squeezeProse('The cache key is the file path.'), 'The cache key is the file path.')
})

// ── maskObservations (JetBrains observation masking) ─────────────────────────
test('maskObservations: keeps recent in full, masks older', () => {
  const big = 'x'.repeat(2000)
  const obs = [
    { label: 's1', text: big },
    { label: 's2', text: big },
    { label: 's3', text: 'recent result' }
  ]
  const out = maskObservations(obs, { keepRecent: 1 })
  assert.match(out, /s1: output masked/)
  assert.match(out, /s2: output masked/)
  assert.ok(out.includes('recent result'), 'most-recent kept in full')
  assert.ok(out.length < big.length, 'older payloads dropped')
})

test('maskObservations: tiny observations are not masked', () => {
  const obs = [
    { label: 'a', text: 'short' },
    { label: 'b', text: 'also short' }
  ]
  const out = maskObservations(obs, { keepRecent: 0, minMaskTokens: 50 })
  assert.ok(out.includes('short'))
  assert.ok(!/output masked/.test(out))
})

// ── createResponseCache (lexical/exact response cache) ───────────────────────
test('responseCache: normalized-exact hit ignores case/whitespace', () => {
  const c = createResponseCache<string>()
  c.set('Summarize  the  FILE', 'done')
  assert.equal(c.get('summarize the file'), 'done')
  assert.equal(c.get('summarize something else'), undefined)
})

test('responseCache: TTL expiry via injected clock', () => {
  let t = 1000
  const c = createResponseCache<string>({ ttlMs: 100, now: () => t })
  c.set('q', 'v')
  t = 1050
  assert.equal(c.get('q'), 'v')
  t = 2000
  assert.equal(c.get('q'), undefined, 'expired past TTL')
})

test('responseCache: fuzzy match only when threshold < 1', () => {
  const exact = createResponseCache<string>({ threshold: 1 })
  exact.set('classify the payment webhook event', 'A')
  assert.equal(exact.get('classify payment webhook events'), undefined)
  const fuzzy = createResponseCache<string>({ threshold: 0.5 })
  fuzzy.set('classify the payment webhook event', 'A')
  assert.equal(fuzzy.get('classify the payment webhook events please'), 'A')
})

test('responseCache: LRU eviction respects capacity', () => {
  const c = createResponseCache<number>({ maxEntries: 2 })
  c.set('a', 1)
  c.set('b', 2)
  c.get('a') // bump a → b is now LRU
  c.set('c', 3) // evicts b
  assert.equal(c.get('b'), undefined)
  assert.equal(c.get('a'), 1)
  assert.equal(c.get('c'), 3)
})
