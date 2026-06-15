// Agent activity store — the data behind the Squad tab's redesign into an AGENT
// DASHBOARD (replacing the manual plan editor). It taps the live AgentEvent bus
// (pet/bus, fed by runStreaming) in the MAIN process so activity is captured no
// matter which tab is focused, and persists a rolling history to a Forge-private
// json so "agents I've used" survives restarts.
//
// Two live feeds (per the redesign decision):
//   • the MAIN agent of each run (kind 'run') + its current action, and
//   • each TASK subagent the model spawns (kind 'task').
// Orchestration runs record via recordOrchestration() from ipc/orchestrate.
//
// On every meaningful change it broadcasts a coalesced snapshot on
// 'activity:update' to all windows; the dashboard renders live + history.
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import type { AgentEvent } from './agent/types'
import { onAgentEvent } from './pet/bus'

export type ActivityKind = 'run' | 'task' | 'orchestration'
export type ActivityStatus = 'running' | 'ok' | 'error'

export interface AgentActivity {
  /** Stable id: runId (run), toolId (task), `${runId}:${subtaskId}` (orchestration). */
  id: string
  kind: ActivityKind
  runId: string
  /** Display name: 'main agent' | subagent_type | role/subtask id. */
  name: string
  /** Description / instruction / the current action while running. */
  detail?: string
  status: ActivityStatus
  startedAt: number
  endedAt?: number
  costUsd?: number
  /** Orchestration verdict, when applicable. */
  pass?: boolean
  score?: number
  /** Orchestration verifier provenance: objective tool oracle vs LLM judge. */
  verifier?: 'tool' | 'judge'
}

export interface ActivitySnapshot {
  live: AgentActivity[]
  history: AgentActivity[]
}

const HISTORY_CAP = 200
const HISTORY_FILE = (): string => join(app.getPath('userData'), 'forge-agent-activity.json')

const live = new Map<string, AgentActivity>()
let history: AgentActivity[] = []
let loaded = false

// blockId → toolId for Task blocks (tool-input carries blockId, result carries toolId).
const taskBlockToTool = new Map<string, string>()
// accumulated tool-input json per Task blockId, to parse subagent_type/description.
const taskInput = new Map<string, string>()

function loadHistory(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = JSON.parse(readFileSync(HISTORY_FILE(), 'utf8'))
    if (Array.isArray(raw)) history = raw.slice(0, HISTORY_CAP)
  } catch {
    history = []
  }
}

function persist(): void {
  try {
    writeFileSync(HISTORY_FILE(), JSON.stringify(history.slice(0, HISTORY_CAP)))
  } catch {
    /* best-effort */
  }
}

export function getSnapshot(): ActivitySnapshot {
  loadHistory()
  // live newest-first; history already newest-first.
  return { live: [...live.values()].sort((a, b) => b.startedAt - a.startedAt), history }
}

// ── Coalesced broadcast ──
let pending: NodeJS.Timeout | null = null
function broadcast(): void {
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    const snap = getSnapshot()
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('activity:update', snap)
    }
  }, 150)
}

/** Move a live entry to history (newest-first, capped) and persist. */
function finish(entry: AgentActivity, status: ActivityStatus, costUsd?: number): void {
  entry.status = status
  entry.endedAt = Date.now()
  if (costUsd != null) entry.costUsd = costUsd
  live.delete(entry.id)
  loadHistory()
  history.unshift(entry)
  if (history.length > HISTORY_CAP) history.length = HISTORY_CAP
  persist()
  broadcast()
}

/** Human label for the main agent's current action, from a streaming event. */
function actionFor(ev: AgentEvent): string | undefined {
  if (ev.type === 'block-start') {
    if (ev.kind === 'thinking') return 'thinking…'
    if (ev.kind === 'text') return 'writing response…'
    if (ev.kind === 'tool') return ev.name ? `${ev.name}…` : 'using a tool…'
  }
  return undefined
}

/** Feed one AgentEvent into the store (subscribed via the bus in initActivity). */
export function onActivityEvent(ev: AgentEvent): void {
  loadHistory()
  // Ensure a 'run' entry exists for any active runId.
  if (!live.has(ev.runId) && ev.type !== 'result') {
    live.set(ev.runId, {
      id: ev.runId,
      kind: 'run',
      runId: ev.runId,
      name: 'main agent',
      detail: 'starting…',
      status: 'running',
      startedAt: Date.now()
    })
    broadcast()
  }
  const run = live.get(ev.runId)

  switch (ev.type) {
    case 'block-start': {
      if (run) {
        const a = actionFor(ev)
        if (a) {
          run.detail = a
          broadcast()
        }
      }
      // A spawned subagent.
      if (ev.kind === 'tool' && ev.name === 'Task' && ev.toolId) {
        taskBlockToTool.set(ev.blockId, ev.toolId)
        live.set(ev.toolId, {
          id: ev.toolId,
          kind: 'task',
          runId: ev.runId,
          name: 'subagent',
          detail: 'spawning…',
          status: 'running',
          startedAt: Date.now()
        })
        broadcast()
      }
      break
    }
    case 'tool-input': {
      // Accumulate a Task block's input json to learn subagent_type/description.
      const toolId = taskBlockToTool.get(ev.blockId)
      if (toolId) {
        const acc = (taskInput.get(ev.blockId) ?? '') + ev.partialJson
        taskInput.set(ev.blockId, acc)
        const t = live.get(toolId)
        if (t) {
          try {
            const o = JSON.parse(acc) as { subagent_type?: string; description?: string }
            if (o.subagent_type) t.name = o.subagent_type
            if (o.description) t.detail = o.description
            broadcast()
          } catch {
            /* still streaming partial json */
          }
        }
      } else if (run && run.detail && !run.detail.includes(' ')) {
        /* keep the short '<Tool>…' action; full args are noisy for the dashboard */
      }
      break
    }
    case 'tool-result': {
      const t = live.get(ev.toolId)
      if (t && t.kind === 'task') finish(t, ev.ok ? 'ok' : 'error')
      break
    }
    case 'result': {
      if (run) finish(run, ev.ok ? 'ok' : 'error', ev.costUsd)
      // Any orphan subagents from this run resolve with the run.
      for (const a of [...live.values()]) {
        if (a.runId === ev.runId && a.kind === 'task') finish(a, ev.ok ? 'ok' : 'error')
      }
      break
    }
    default:
      break
  }
}

/** Record an orchestration subtask (called from ipc/orchestrate). */
export function recordOrchestration(entry: {
  runId: string
  subtaskId: string
  name: string
  detail?: string
  status: ActivityStatus
  costUsd?: number
  pass?: boolean
  score?: number
  verifier?: 'tool' | 'judge'
}): void {
  loadHistory()
  const id = `${entry.runId}:${entry.subtaskId}`
  if (entry.status === 'running') {
    live.set(id, {
      id,
      kind: 'orchestration',
      runId: entry.runId,
      name: entry.name,
      detail: entry.detail,
      status: 'running',
      startedAt: Date.now()
    })
    broadcast()
    return
  }
  const cur = live.get(id) ?? {
    id,
    kind: 'orchestration' as const,
    runId: entry.runId,
    name: entry.name,
    detail: entry.detail,
    status: 'running' as ActivityStatus,
    startedAt: Date.now()
  }
  cur.detail = entry.detail ?? cur.detail
  cur.pass = entry.pass
  cur.score = entry.score
  cur.verifier = entry.verifier
  finish(cur, entry.status, entry.costUsd)
}

/** Clear persisted + live history (dashboard "clear" button). */
export function clearHistory(): void {
  history = []
  persist()
  broadcast()
}

let unsubscribe: (() => void) | null = null
/** Subscribe the store to the agent event bus. Call once after app ready. */
export function initActivity(): void {
  loadHistory()
  if (!unsubscribe) unsubscribe = onAgentEvent(onActivityEvent)
}
