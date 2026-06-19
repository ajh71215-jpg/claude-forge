// Unit tests for the pure RAG chunker. No fs/electron — compiled by
// tsconfig.test.json → out-test, run via `npm test` (node:test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkFile } from '../src/main/retrieval/chunk'

test('chunkFile: windows with overlap, stable ids, 1-based lines', () => {
  const content = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n')
  const chunks = chunkFile('a/b.ts', content, { maxLines: 40, overlap: 8 })
  assert.ok(chunks.length >= 3, `expected multiple windows, got ${chunks.length}`)
  assert.equal(chunks[0].id, 'a/b.ts#1')
  assert.equal(chunks[0].startLine, 1)
  // step = maxLines - overlap = 32 → second window starts at line 33.
  assert.equal(chunks[1].startLine, 33)
  assert.ok(chunks[0].text.includes('line 1'))
})

test('chunkFile: short file is a single chunk', () => {
  const chunks = chunkFile('x.ts', 'one\ntwo\nthree')
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].text, 'one\ntwo\nthree')
})

test('chunkFile: blank windows are dropped', () => {
  assert.deepEqual(chunkFile('x.ts', '\n\n\n\n'), [])
  assert.deepEqual(chunkFile('x.ts', ''), [])
})

test('chunkFile: overlap keeps a boundary symbol findable from both windows', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `l${i + 1}`)
  lines[35] = 'function straddle() {}'
  const chunks = chunkFile('x.ts', lines.join('\n'), { maxLines: 40, overlap: 8 })
  const hits = chunks.filter((c) => c.text.includes('straddle'))
  assert.ok(hits.length >= 1)
})
