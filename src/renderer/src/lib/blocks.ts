// Pure transcript/block reducers. Leaf module (docs/MAINTAINABILITY.md Phase 0):
// no JSX, no component imports — depends only on ./types. Extracted verbatim from
// App.tsx — behavior-preserving.
import type { AgentEvent, Block, Todo, Turn } from '../types'

function normTaskStatus(s: string): Todo['status'] {
  return s === 'completed' ? 'completed' : s === 'in_progress' ? 'in_progress' : 'pending'
}

/**
 * Reconstruct the current task list from Task-tool activity across the live
 * transcript. The SDK's models manage work via TaskCreate/TaskUpdate/TaskList
 * (not TodoWrite), so we replay those calls:
 *  - TaskCreate result "Task #<id> created successfully: <subject>" → add task
 *  - TaskUpdate input { taskId, status, subject? }                 → mutate task
 *  - TaskList result "#<id> [<status>] <subject>" (per line)       → snapshot sync
 */
export function deriveTasks(turns: Turn[]): Todo[] {
  type T = Todo & { id: string }
  const map = new Map<string, T>()
  const order: string[] = []
  const upsert = (id: string, patch: Partial<T>): void => {
    const cur = map.get(id)
    if (!cur) {
      order.push(id)
      map.set(id, {
        id,
        content: patch.content ?? `Task ${id}`,
        status: patch.status ?? 'pending',
        activeForm: patch.activeForm
      })
    } else {
      map.set(id, { ...cur, ...patch })
    }
  }
  for (const turn of turns) {
    for (const b of turn.blocks) {
      if (b.kind !== 'tool') continue
      if (b.name === 'TaskCreate') {
        const m = /Task #(\d+) created successfully:\s*([\s\S]+)/.exec(b.result ?? '')
        if (m) {
          let activeForm: string | undefined
          try {
            activeForm = (JSON.parse(b.inputRaw) as { activeForm?: string }).activeForm
          } catch {
            /* still streaming */
          }
          upsert(m[1], { content: m[2].trim(), activeForm })
        }
      } else if (b.name === 'TaskUpdate') {
        try {
          const inp = JSON.parse(b.inputRaw) as {
            taskId?: string | number
            status?: string
            subject?: string
            activeForm?: string
          }
          if (inp.taskId != null) {
            const id = String(inp.taskId)
            if (inp.status === 'deleted') {
              map.delete(id)
              const i = order.indexOf(id)
              if (i >= 0) order.splice(i, 1)
            } else {
              upsert(id, {
                ...(inp.status ? { status: normTaskStatus(inp.status) } : {}),
                ...(inp.subject ? { content: inp.subject } : {}),
                ...(inp.activeForm ? { activeForm: inp.activeForm } : {})
              })
            }
          }
        } catch {
          /* partial JSON mid-stream */
        }
      } else if (b.name === 'TaskList') {
        for (const line of (b.result ?? '').split('\n')) {
          const m = /^#(\d+)\s+\[([a-z_]+)\]\s+([\s\S]+)$/.exec(line.trim())
          if (m) upsert(m[1], { content: m[3].trim(), status: normTaskStatus(m[2]) })
        }
      }
    }
  }
  return order
    .map((id) => map.get(id))
    .filter((t): t is T => !!t)
    .map(({ content, status, activeForm }) => ({ content, status, activeForm }))
}

/** Apply one streaming event to a turn's ordered block list. */
export function reduceBlocks(blocks: Block[], ev: AgentEvent): Block[] {
  if (ev.type === 'block-start') {
    if (blocks.some((b) => b.id === ev.blockId)) return blocks
    if (ev.kind === 'tool') {
      const t: Block = {
        kind: 'tool',
        id: ev.blockId,
        toolId: ev.toolId ?? ev.blockId,
        name: ev.name ?? 'tool',
        inputRaw: '',
        status: 'running',
        parentToolId: ev.parentToolId ?? null
      }
      return [...blocks, t]
    }
    const t: Block = { kind: ev.kind, id: ev.blockId, text: '' }
    return [...blocks, t]
  }
  if (ev.type === 'block-delta') {
    return blocks.map((b) =>
      b.id === ev.blockId && (b.kind === 'text' || b.kind === 'thinking')
        ? { ...b, text: b.text + ev.text }
        : b
    )
  }
  if (ev.type === 'tool-input') {
    return blocks.map((b) =>
      b.id === ev.blockId && b.kind === 'tool' ? { ...b, inputRaw: b.inputRaw + ev.partialJson } : b
    )
  }
  if (ev.type === 'tool-result') {
    return blocks.map((b) =>
      b.kind === 'tool' && b.toolId === ev.toolId
        ? { ...b, status: ev.ok ? 'ok' : 'error', result: ev.content }
        : b
    )
  }
  return blocks
}

export function parseTodos(input: unknown): Todo[] | null {
  try {
    const o = typeof input === 'string' ? JSON.parse(input) : input
    const todos = (o as { todos?: unknown })?.todos
    if (Array.isArray(todos)) {
      return todos
        .filter((t): t is Todo => !!t && typeof (t as Todo).content === 'string')
        .map((t) => ({
          content: t.content,
          status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending',
          activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined
        }))
    }
  } catch {
    /* partial JSON while streaming */
  }
  return null
}
