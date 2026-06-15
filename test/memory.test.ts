// Unit tests for the pure memory cores absorbed from agentmemory: observation
// transform + privacy filter, BM25 ranking, and budget-bounded diverse recall.
// No DOM/Electron/SDK — compiled by tsconfig.test.json, run via `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observationToEntry, redactSecrets, fnv1a } from '../src/main/memory/observe'
import { rankBm25, tokenize } from '../src/main/memory/bm25'
import { retrieve, assembleMemory } from '../src/main/memory/retrieve'
import type { MemoryEntry } from '../src/main/memory/types'

function entry(p: Partial<MemoryEntry> & { id: string; text: string }): MemoryEntry {
  return {
    kind: 'semantic',
    tags: [],
    source: 'test',
    hash: fnv1a(p.text),
    createdAt: Date.now(),
    lastAccess: Date.now(),
    accessCount: 0,
    ...p
  }
}

// ── observe.ts ───────────────────────────────────────────────────────────────
test('observationToEntry: Edit → semantic fact with ext tag', () => {
  const e = observationToEntry({ tool: 'Edit', input: { file_path: 'src/app.ts' }, ok: true })
  assert.ok(e)
  assert.equal(e!.kind, 'semantic')
  assert.match(e!.text, /Edited src\/app\.ts/)
  assert.ok(e!.tags.includes('ts'))
  assert.ok(e!.tags.includes('edit'))
})

test('observationToEntry: Bash → procedural', () => {
  const e = observationToEntry({ tool: 'Bash', input: { command: 'npm test' }, ok: true })
  assert.equal(e!.kind, 'procedural')
  assert.match(e!.text, /Ran: npm test/)
})

test('observationToEntry: Read/Grep are dropped as noise', () => {
  assert.equal(observationToEntry({ tool: 'Read', input: { file_path: 'x' }, ok: true }), null)
  assert.equal(observationToEntry({ tool: 'Grep', input: { pattern: 'x' }, ok: true }), null)
})

test('redactSecrets: strips keys, tokens, private spans', () => {
  const r = redactSecrets('key sk-ant-abcd1234efgh and <private>hush</private>')
  assert.ok(r.hadSecret)
  assert.ok(!r.text.includes('sk-ant-abcd1234efgh'))
  assert.ok(!r.text.includes('hush'))
})

test('redactSecrets: KEY=value keeps name, hides value', () => {
  const r = redactSecrets('API_TOKEN=supersecretvalue')
  assert.ok(r.hadSecret)
  assert.match(r.text, /API_TOKEN=\[redacted\]/)
  assert.ok(!r.text.includes('supersecretvalue'))
})

test('fnv1a: deterministic + collision-resistant enough for dedupe', () => {
  assert.equal(fnv1a('hello'), fnv1a('hello'))
  assert.notEqual(fnv1a('hello'), fnv1a('world'))
})

// ── bm25.ts ──────────────────────────────────────────────────────────────────
test('tokenize: drops stopwords and 1-char tokens', () => {
  assert.deepEqual(tokenize('the Auth Module x'), ['auth', 'module'])
})

test('rankBm25: relevant doc ranks first', () => {
  const docs = [
    { id: 'a', text: 'edited the authentication login module' },
    { id: 'b', text: 'wrote the billing invoice calculator' },
    { id: 'c', text: 'ran the database migration' }
  ]
  const hits = rankBm25('auth login', docs)
  assert.equal(hits[0].id, 'a')
  assert.ok(!hits.some((h) => h.id === 'b' && h.score > hits[0].score))
})

test('rankBm25: empty query → no hits', () => {
  assert.deepEqual(rankBm25('the a an', [{ id: 'x', text: 'hello world' }]), [])
})

// ── retrieve.ts ──────────────────────────────────────────────────────────────
test('retrieve: ranks relevant, respects token budget', () => {
  const now = Date.now()
  const entries = [
    entry({ id: '1', text: 'Edited src/auth/login.ts', createdAt: now }),
    entry({ id: '2', text: 'Edited src/billing/invoice.ts', createdAt: now }),
    entry({ id: '3', text: 'Ran: npm run build', kind: 'procedural', createdAt: now })
  ]
  const got = retrieve(entries, 'auth login', { budgetTokens: 2000, now })
  assert.equal(got[0].id, '1')
})

test('retrieve: enforces per-session diversity', () => {
  const now = Date.now()
  const entries = Array.from({ length: 6 }, (_, i) =>
    entry({ id: String(i), text: `Edited auth file ${i}`, sessionId: 'S', createdAt: now })
  )
  const got = retrieve(entries, 'auth file', { maxPerSession: 3, budgetTokens: 9999, now })
  assert.equal(got.length, 3)
})

test('retrieve: tiny budget yields fewer entries', () => {
  const now = Date.now()
  const entries = Array.from({ length: 10 }, (_, i) =>
    entry({ id: String(i), text: `Edited auth module file number ${i}`, sessionId: `S${i}`, createdAt: now })
  )
  const got = retrieve(entries, 'auth module', { budgetTokens: 10, now })
  assert.ok(got.length >= 1 && got.length < 10)
})

test('retrieve: recency decay favors newer over older', () => {
  const now = Date.now()
  const entries = [
    entry({ id: 'old', text: 'Edited auth handler', sessionId: 'A', createdAt: now - 60 * 86_400_000 }),
    entry({ id: 'new', text: 'Edited auth handler', sessionId: 'B', createdAt: now })
  ]
  const got = retrieve(entries, 'auth handler', { halfLifeMs: 14 * 86_400_000, now })
  assert.equal(got[0].id, 'new')
})

test('assembleMemory: kind-tagged bullets', () => {
  const out = assembleMemory([entry({ id: '1', text: 'Edited x.ts' })])
  assert.match(out, /- \(semantic\) Edited x\.ts/)
})
