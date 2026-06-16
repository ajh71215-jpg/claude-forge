// Auto-capture: tap the agent event bus in the MAIN process (the same bus the
// pet and the activity store use) and turn durable tool actions into memory
// entries — agentmemory's "12 silent PostToolUse hooks, zero manual /add()".
// Zero extra tokens/model calls; pure local capture. Reconstructs each tool's
// input from the already-streamed block-start/tool-input/tool-result events.

import { onAgentEvent } from '../pet/bus'
import { observationToEntry } from './observe'
import { addMemory } from './store'
import type { AgentEvent } from '../agent/types'

interface ToolState {
  name: string
  json: string
}
interface RunState {
  sessionId?: string
  workspaceId?: string
  tools: Map<string, ToolState> // toolId → state
  blockToTool: Map<string, string> // blockId → toolId
}

const runs = new Map<string, RunState>()

function getRun(runId: string): RunState {
  let r = runs.get(runId)
  if (!r) {
    r = { tools: new Map(), blockToTool: new Map() }
    runs.set(runId, r)
  }
  return r
}

/** runStreaming notes the per-run workspace so captured facts can be scoped. */
export function noteRunWorkspace(runId: string, workspaceId?: string): void {
  if (workspaceId) getRun(runId).workspaceId = workspaceId
}

let started = false

/** Start capturing once at app boot (idempotent). */
export function initMemoryCapture(): void {
  if (started) return
  started = true
  onAgentEvent((ev: AgentEvent) => {
    void handle(ev).catch(() => {
      /* capture must never break a run */
    })
  })
}

async function handle(ev: AgentEvent): Promise<void> {
  const runId = (ev as { runId?: string }).runId
  if (!runId) return
  switch (ev.type) {
    case 'session': {
      getRun(runId).sessionId = ev.sessionId
      break
    }
    case 'block-start': {
      if (ev.kind === 'tool' && ev.toolId) {
        const r = getRun(runId)
        r.tools.set(ev.toolId, { name: ev.name ?? '', json: '' })
        r.blockToTool.set(ev.blockId, ev.toolId)
      }
      break
    }
    case 'tool-input': {
      const r = runs.get(runId)
      const toolId = r?.blockToTool.get(ev.blockId)
      const t = toolId ? r!.tools.get(toolId) : undefined
      if (t) t.json += ev.partialJson
      break
    }
    case 'tool-result': {
      const r = runs.get(runId)
      const t = r?.tools.get(ev.toolId)
      if (!r || !t) break
      r.tools.delete(ev.toolId)
      let input: Record<string, unknown> = {}
      try {
        input = t.json ? (JSON.parse(t.json) as Record<string, unknown>) : {}
      } catch {
        input = {}
      }
      const cand = observationToEntry({
        tool: t.name,
        input,
        ok: ev.ok,
        sessionId: r.sessionId,
        workspaceId: r.workspaceId
      })
      if (cand) await addMemory(cand)
      break
    }
    case 'result': {
      runs.delete(runId) // run ended — drop its reconstruction state
      break
    }
  }
}
