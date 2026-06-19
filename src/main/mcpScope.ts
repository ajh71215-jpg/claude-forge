// Pure per-conversation MCP-scope filter (no electron/SDK imports → unit-testable
// headlessly via `npm run test`). A conversation can choose to load only a subset
// of the configured MCP servers; every server's tool definitions are re-sent each
// turn (the "MCP tax", docs/TOKEN_OPTIMIZATION.md §10 / report §5), so dropping the
// servers a conversation doesn't need trims per-turn input tokens.
//
// Semantics: `undefined` scope = ALL servers (default, zero behavior change); an
// explicit list keeps only the named servers (unknown names are ignored); `[]`
// keeps none. Generic over `{ name }` so both McpServerEntry and the SDK-shape
// record callers can reuse it.

export function scopeMcpServers<T extends { name: string }>(
  servers: T[],
  scope?: readonly string[]
): T[] {
  if (!scope) return servers
  const want = new Set(scope)
  return servers.filter((s) => want.has(s.name))
}
