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

/** One tool an agent invoked (Read/Bash/Write/…) — built from events already
 * streamed, so capturing it adds NO token/model cost. */
export interface ToolEvent {
  id: string
  name: string
  /** Short, salient argument (file path / command / pattern / url). */
  arg?: string
  status: ActivityStatus
  startedAt: number
  endedAt?: number
}

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
  /** Tools this agent used, in order. For subagents these are attributed via the
   * SDK parent_tool_use_id, so a subagent's inner Read/Bash/… nest under it. */
  tools?: ToolEvent[]
  /** Subagent usage from native SDK task_* messages. */
  tokens?: number
  toolUses?: number
  // ── Per-run token/cache breakdown (kind 'run'), from the SDK result message.
  //    Captured here so the Cost/Cache dashboard has durable history — these were
  //    previously streamed on the `result` event but dropped (only costUsd kept).
  /** Fresh (non-cached) input tokens. */
  inputTokens?: number
  /** Output tokens generated. */
  outputTokens?: number
  /** cache_read_input_tokens — the cheap (0.1×) cache-hit side. */
  cacheReadTokens?: number
  /** cache_creation_input_tokens — the cache-write side. */
  cacheWriteTokens?: number
  /** Total context tokens at the end of the run (fresh + cache read + cache write). */
  contextTokens?: number
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

// Tool-call bookkeeping (tool-input carries blockId, tool-result carries toolId).
const toolBlockToTool = new Map<string, string>() // blockId → toolId (every tool)
const toolBlockOf = new Map<string, string>() // toolId → blockId (for cleanup)
const toolOwner = new Map<string, string>() // toolId → owner entry id (run OR subagent)
const toolInput = new Map<string, string>() // blockId → accumulated input json
const taskIdToEntryId = new Map<string, string>() // SDK task_id → our subagent entry id

const TOOLS_CAP = 200

/** Pull a short, salient argument out of a tool's (possibly partial) input json. */
function shortArg(json: string): string {
  try {
    const o = JSON.parse(json) as Record<string, unknown>
    const pick =
      o.file_path ?? o.path ?? o.command ?? o.pattern ?? o.url ?? o.query ?? o.description ?? o.prompt
    if (typeof pick === 'string') return pick.length > 90 ? pick.slice(0, 90) + '…' : pick
  } catch {
    /* still streaming partial json */
  }
  return ''
}

/** Locate a run's ToolEvent by toolId. */
function toolOf(toolId: string): ToolEvent | undefined {
  const runId = toolOwner.get(toolId)
  if (!runId) return undefined
  return live.get(runId)?.tools?.find((t) => t.id === toolId)
}

/** Drop the per-block bookkeeping for a finished tool. */
function cleanupTool(toolId: string): void {
  const blockId = toolBlockOf.get(toolId)
  if (blockId) {
    toolBlockToTool.delete(blockId)
    toolInput.delete(blockId)
  }
  toolBlockOf.delete(toolId)
  toolOwner.delete(toolId)
}

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

// Coalesce disk writes: finish() can fire many times per second under
// orchestration (per run / subtask / tool), so collapse a burst into one
// write instead of synchronously serializing the whole history each time.
let persistTimer: NodeJS.Timeout | null = null
function persist(): void {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      writeFileSync(HISTORY_FILE(), JSON.stringify(history.slice(0, HISTORY_CAP)))
    } catch {
      /* best-effort */
    }
  }, 250)
}

/** Force any pending coalesced write to disk immediately. Called on app quit so a
 * just-finished run (whose 250ms persist timer hasn't fired yet) isn't lost when
 * the process exits. No-op when nothing is pending. */
export function flushActivity(): void {
  if (!persistTimer) return
  clearTimeout(persistTimer)
  persistTimer = null
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
      // A subagent's block carries parent_tool_use_id → attribute to that
      // subagent's entry; otherwise to the lead run.
      const isSub = !!ev.parentToolId && live.has(ev.parentToolId)
      const targetId = isSub ? (ev.parentToolId as string) : ev.runId
      const target = live.get(targetId)
      if (target) {
        const a = actionFor(ev)
        if (a) target.detail = a
      }
      if (ev.kind === 'tool' && ev.toolId) {
        // Record the tool on the owner's timeline (no token cost — streamed anyway).
        if (target) {
          const te: ToolEvent = {
            id: ev.toolId,
            name: ev.name ?? 'tool',
            status: 'running',
            startedAt: Date.now()
          }
          target.tools = target.tools ?? []
          target.tools.push(te)
          if (target.tools.length > TOOLS_CAP) target.tools.splice(0, target.tools.length - TOOLS_CAP)
        }
        toolBlockToTool.set(ev.blockId, ev.toolId)
        toolBlockOf.set(ev.toolId, ev.blockId)
        toolOwner.set(ev.toolId, targetId)
        // A lead-issued Task tool spawns a tracked subagent card (keyed by its
        // tool_use_id so subagent blocks attribute back to it).
        if (ev.name === 'Task' && !isSub) {
          live.set(ev.toolId, {
            id: ev.toolId,
            kind: 'task',
            runId: ev.runId,
            name: 'subagent',
            detail: 'spawning…',
            status: 'running',
            startedAt: Date.now()
          })
        }
      }
      broadcast()
      break
    }
    case 'tool-input': {
      const toolId = toolBlockToTool.get(ev.blockId)
      if (toolId) {
        const acc = (toolInput.get(ev.blockId) ?? '') + ev.partialJson
        toolInput.set(ev.blockId, acc)
        const arg = shortArg(acc)
        if (arg) {
          const te = toolOf(toolId)
          if (te) te.arg = arg
          // For a Task, derive the subagent's type/description from the same json.
          const task = live.get(toolId)
          if (task && task.kind === 'task') {
            try {
              const o = JSON.parse(acc) as { subagent_type?: string; description?: string }
              if (o.subagent_type) task.name = o.subagent_type
              if (o.description) task.detail = o.description
            } catch {
              /* partial */
            }
          }
          broadcast()
        }
      }
      break
    }
    case 'tool-result': {
      const te = toolOf(ev.toolId)
      if (te) {
        te.status = ev.ok ? 'ok' : 'error'
        te.endedAt = Date.now()
      }
      const task = live.get(ev.toolId)
      if (task && task.kind === 'task') {
        // If the native task-* lifecycle is tracking this card, let task-done /
        // task-updated finalize it: those carry the final summary + usage that
        // arrive AFTER the Task tool returns, so finishing here would drop them.
        // (Any card the lifecycle never closes is reaped by the run's 'result'.)
        const trackedNatively = [...taskIdToEntryId.values()].includes(ev.toolId)
        if (!trackedNatively) finish(task, ev.ok ? 'ok' : 'error')
      }
      cleanupTool(ev.toolId)
      broadcast()
      break
    }
    // ── Native subagent (Task) lifecycle — enriches the inferred Task card with
    //    real subagent_type / description / usage / status. ──
    case 'task-started': {
      const entryId = ev.toolUseId ?? `task:${ev.taskId}`
      taskIdToEntryId.set(ev.taskId, entryId)
      const e = live.get(entryId)
      if (e && e.kind === 'task') {
        if (ev.subagentType) e.name = ev.subagentType
        if (ev.description) e.detail = ev.description
      } else if (!e) {
        live.set(entryId, {
          id: entryId,
          kind: 'task',
          runId: ev.runId,
          name: ev.subagentType ?? 'subagent',
          detail: ev.description,
          status: 'running',
          startedAt: Date.now()
        })
      }
      broadcast()
      break
    }
    case 'task-progress': {
      const e = live.get(taskIdToEntryId.get(ev.taskId) ?? '')
      if (e) {
        if (ev.subagentType) e.name = ev.subagentType
        if (ev.totalTokens != null) e.tokens = ev.totalTokens
        if (ev.toolUses != null) e.toolUses = ev.toolUses
        broadcast()
      }
      break
    }
    case 'task-updated': {
      const e = live.get(taskIdToEntryId.get(ev.taskId) ?? '')
      if (e) {
        if (ev.description) e.detail = ev.description
        if (ev.status === 'completed') finish(e, 'ok')
        else if (ev.status === 'failed' || ev.status === 'killed') finish(e, 'error')
        else broadcast()
      }
      break
    }
    case 'task-done': {
      const e = live.get(taskIdToEntryId.get(ev.taskId) ?? ev.toolUseId ?? '')
      if (e) {
        if (ev.summary) e.detail = ev.summary
        if (ev.totalTokens != null) e.tokens = ev.totalTokens
        if (ev.toolUses != null) e.toolUses = ev.toolUses
        finish(e, ev.status === 'completed' ? 'ok' : 'error')
      }
      taskIdToEntryId.delete(ev.taskId)
      break
    }
    case 'api-retry': {
      if (run) {
        run.detail = `retrying (${ev.errorStatus ?? 'error'}) — attempt ${ev.attempt}/${ev.maxRetries}…`
        broadcast()
      }
      break
    }
    case 'result': {
      if (run) {
        // Capture the token/cache breakdown (already streamed) so it persists in
        // history for the Cost/Cache dashboard — not just the cost.
        if (ev.inputTokens != null) run.inputTokens = ev.inputTokens
        if (ev.outputTokens != null) run.outputTokens = ev.outputTokens
        if (ev.cacheReadTokens != null) run.cacheReadTokens = ev.cacheReadTokens
        if (ev.cacheWriteTokens != null) run.cacheWriteTokens = ev.cacheWriteTokens
        if (ev.contextTokens != null) run.contextTokens = ev.contextTokens
        finish(run, ev.ok ? 'ok' : 'error', ev.costUsd)
      }
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

// ── Delegated goose subtasks (docs/GOOSE_INTEGRATION.md) ──
// A delegate(...) call runs a subtask on a free model via goose. It surfaces as a
// 'task' card nested under the main run (same runId), with a tool timeline built
// from goose's session/update notifications — same shape as a native subagent, so
// the dashboard renders it with no new UI. Zero extra model cost.

/** Start a delegated-subtask card; returns its entry id. */
export function gooseSubtaskStart(runId: string, name: string, detail?: string): string {
  loadHistory()
  const id = `goose:${runId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`
  live.set(id, {
    id,
    kind: 'task',
    runId,
    name,
    detail: detail && detail.length > 90 ? detail.slice(0, 90) + '…' : detail,
    status: 'running',
    startedAt: Date.now()
  })
  broadcast()
  return id
}

/** Record/append a tool the delegated sub-agent used (Read/Bash/Write/…). */
export function gooseSubtaskTool(
  id: string,
  name: string,
  arg?: string,
  status?: string
): void {
  const e = live.get(id)
  if (!e) return
  e.tools = e.tools ?? []
  const done = status === 'completed' || status === 'success' || status === 'failed'
  // Update the most recent running tool of the same name, else push a new one.
  const open = [...e.tools].reverse().find((t) => t.name === name && t.status === 'running')
  if (open) {
    if (arg && !open.arg) open.arg = arg
    if (done) {
      open.status = status === 'failed' ? 'error' : 'ok'
      open.endedAt = Date.now()
    }
  } else {
    e.tools.push({
      id: `${id}:t${e.tools.length}`,
      name,
      arg,
      status: done ? (status === 'failed' ? 'error' : 'ok') : 'running',
      startedAt: Date.now(),
      endedAt: done ? Date.now() : undefined
    })
    if (e.tools.length > TOOLS_CAP) e.tools.splice(0, e.tools.length - TOOLS_CAP)
  }
  e.detail = `${name}…`
  broadcast()
}

/** Finalize a delegated-subtask card. */
export function gooseSubtaskFinish(
  id: string,
  status: ActivityStatus,
  opts?: { tokensUsed?: number; costUsd?: number; detail?: string }
): void {
  const e = live.get(id)
  if (!e) return
  if (opts?.tokensUsed != null) e.tokens = opts.tokensUsed
  if (opts?.detail) e.detail = opts.detail
  // Close any tools still marked running.
  for (const t of e.tools ?? []) if (t.status === 'running') { t.status = 'ok'; t.endedAt = Date.now() }
  finish(e, status, opts?.costUsd ?? 0)
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
