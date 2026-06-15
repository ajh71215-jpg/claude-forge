// One user→assistant exchange in the live transcript (docs/MAINTAINABILITY.md
// Phase 2). Extracted verbatim from App.tsx — behavior-preserving. Memoization
// is docs/PERFORMANCE.md lever 3 (do not change without re-profiling).
import { Fragment, memo, useState, type JSX } from 'react'
import type { Block, Turn } from '../../types'
import BlockView from './BlockView'
import Elapsed from './Elapsed'

/** One user→assistant exchange in the live transcript. */
// Memoized: completed turns keep a stable `turn` ref and stable callbacks, so a
// streaming flush only re-renders the active turn. docs/PERFORMANCE.md lever 3.
const TurnView = memo(function TurnView({
  turn,
  onRetry,
  onEdit
}: {
  turn: Turn
  onRetry: (prompt: string) => void
  onEdit: (prompt: string) => void
}): JSX.Element {
  // Subagent tool groups can be collapsed (set of parent toolIds the user hid).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const lastId = turn.blocks.length ? turn.blocks[turn.blocks.length - 1].id : null

  // Group a subagent's tool blocks under their parent Task. A block is a child
  // iff its parentToolId matches the toolId of another tool block in this turn
  // (the SDK forwards parent_tool_use_id). One pass builds the parent→children
  // map; the rest render at top level. (Mirrors agentActivity.ts attribution.)
  const toolIds = new Set<string>()
  for (const b of turn.blocks) if (b.kind === 'tool') toolIds.add(b.toolId)
  const childrenByParent = new Map<string, Block[]>()
  const isChild = (b: Block): boolean =>
    b.kind === 'tool' && !!b.parentToolId && toolIds.has(b.parentToolId)
  for (const b of turn.blocks) {
    if (b.kind === 'tool' && b.parentToolId && toolIds.has(b.parentToolId)) {
      const arr = childrenByParent.get(b.parentToolId)
      if (arr) arr.push(b)
      else childrenByParent.set(b.parentToolId, [b])
    }
  }
  const topLevel = turn.blocks.filter((b) => !isChild(b))

  // Render a list of blocks, recursively nesting any subagent children under the
  // parent Task (depth>0 → indented + collapsible). Depth is normally ≤1 (the
  // lead spawns subagents; subagents rarely spawn more), but recursion keeps any
  // block from being dropped at deeper nesting.
  const render = (list: Block[], depth: number): JSX.Element[] =>
    list.map((b) => {
      const toolId = b.kind === 'tool' ? b.toolId : null
      const kids = toolId ? childrenByParent.get(toolId) : undefined
      const node = (
        <BlockView block={b} streaming={turn.running && b.id === lastId} nested={depth > 0} />
      )
      if (!toolId || !kids || kids.length === 0) return <Fragment key={b.id}>{node}</Fragment>
      const isCollapsed = collapsed.has(toolId)
      return (
        <Fragment key={b.id}>
          {node}
          <div className="subagent-nest">
            <button className="subagent-toggle" onClick={() => toggle(toolId)}>
              ↳ subagent · {kids.length} tool{kids.length === 1 ? '' : 's'}{' '}
              {isCollapsed ? '▸' : '▾'}
            </button>
            {!isCollapsed && <div className="subagent-tools">{render(kids, depth + 1)}</div>}
          </div>
        </Fragment>
      )
    })

  function copy(): void {
    const text = turn.blocks
      .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n\n')
    if (text) navigator.clipboard?.writeText(text)
  }
  return (
    <div className="turn">
      <div className="user-msg">
        {turn.previews.length > 0 && (
          <div className="user-imgs">
            {turn.previews.map((p, i) => (
              <img key={i} src={p} alt="" />
            ))}
          </div>
        )}
        {turn.prompt}
      </div>
      {render(topLevel, 0)}
      {turn.running && turn.blocks.length === 0 && (
        <div className="forging">
          <span className="forging-dot" />
          forging…
          <Elapsed className="forging-elapsed" />
        </div>
      )}
      {turn.meta?.error && (
        <div className="response response-error">
          <pre className="response-text">⚠ {turn.meta.error}</pre>
        </div>
      )}
      {turn.meta && !turn.meta.error && !turn.running && (
        <div className="response-footer">
          <div className="response-meta standalone">
            {typeof turn.meta.costUsd === 'number' && <span>${turn.meta.costUsd.toFixed(4)}</span>}
            {typeof turn.meta.durationMs === 'number' && (
              <span>{(turn.meta.durationMs / 1000).toFixed(1)}s</span>
            )}
          </div>
          <div className="msg-actions">
            <button className="msg-act" onClick={copy} title="Copy response">
              ⧉ copy
            </button>
            <button
              className="msg-act"
              onClick={() => onRetry(turn.prompt)}
              title="Retry same prompt"
            >
              ↻ retry
            </button>
            <button className="msg-act" onClick={() => onEdit(turn.prompt)} title="Edit & resend">
              ✎ edit
            </button>
          </div>
        </div>
      )}
    </div>
  )
})

export default TurnView
