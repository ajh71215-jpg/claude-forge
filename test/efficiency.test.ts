// Unit tests for the pure efficiency cores absorbed from headroom (compression)
// and agentmemory (memory retrieval). No DOM/Electron/SDK — compiled by
// tsconfig.test.json → out-test, run via `npm test` (node:test). Same cheap,
// always-available gate as the orchestration selftest and the renderer-lib tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateTokens,
  compressText,
  compressContext
} from '../src/main/efficiency/compress'

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
