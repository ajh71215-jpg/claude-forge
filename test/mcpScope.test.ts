// Unit tests for the pure per-conversation MCP-scope filter. No electron/SDK —
// compiled by tsconfig.test.json → out-test, run via `npm test` (node:test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scopeMcpServers } from '../src/main/mcpScope'

const servers = [{ name: 'github' }, { name: 'slack' }, { name: 'sentry' }]

test('scopeMcpServers: undefined scope ⇒ all servers (default)', () => {
  assert.deepEqual(scopeMcpServers(servers), servers)
})

test('scopeMcpServers: explicit list keeps only the named servers', () => {
  assert.deepEqual(
    scopeMcpServers(servers, ['github', 'sentry']).map((s) => s.name),
    ['github', 'sentry']
  )
})

test('scopeMcpServers: empty scope ⇒ none', () => {
  assert.deepEqual(scopeMcpServers(servers, []), [])
})

test('scopeMcpServers: unknown names are ignored', () => {
  assert.deepEqual(
    scopeMcpServers(servers, ['github', 'does-not-exist']).map((s) => s.name),
    ['github']
  )
})

test('scopeMcpServers: preserves original order, not scope order', () => {
  assert.deepEqual(
    scopeMcpServers(servers, ['sentry', 'github']).map((s) => s.name),
    ['github', 'sentry']
  )
})
