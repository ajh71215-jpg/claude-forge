// Run one delegated subtask on a free/cheaper model via `goose acp`
// (docs/GOOSE_INTEGRATION.md §4) — the adapter the delegate tool calls.
//
// Lifecycle: spawn goose acp → initialize → session/new(cwd) → set_mode →
// session/prompt(text) → accumulate agent_message_chunk text → shutdown.
//
// Permission gate (port of subtaskRunner.canUseTool):
//   - writeCapable → GOOSE_MODE=auto (goose auto-runs tools; the orchestrator
//     Claude is the safety net + optional verifyCommands).
//   - read-only   → GOOSE_MODE=approve + a session/request_permission handler
//     that allows only read-family tools and REJECTS everything else (and rejects
//     on any uncertainty — safe by default).
// NOTE: the exact session/request_permission payload shape was documented by
// Octopal but not re-verified live; the handler reads several likely fields and
// fails closed. Confirm in the keyed spike (scripts/goose-spike.mjs).

import { AcpClient, type SessionUpdate } from './acpClient'
import { resolveGooseBinary } from './binary'
import { buildGooseEnv, type GooseMode } from './env'
import { mapUpdate, normalizeTool } from './mapper'
import {
  acquireGooseSlot,
  isRunKilled,
  registerGooseClient,
  releaseGooseSlot,
  unregisterGooseClient
} from './registry'
import type { ProviderEntry } from '../providers'

/**
 * Read-only Forge labels a read-only subtask may use; everything else (Write /
 * Edit / Bash) is rejected. Classification is delegated to the mapper's
 * `normalizeTool` so live goose tool names ('read'/'tree'/'fetch') and the legacy
 * `developer__*` form resolve through one source of truth.
 */
const READ_ONLY_LABELS = new Set(['Read', 'List', 'WebFetch'])

export interface GooseSubtaskOptions {
  instruction: string
  provider: ProviderEntry
  /** Read-only context (prior results) prepended to the prompt. */
  context?: string
  /** Extra persona/guidance (e.g. roles.ts systemAppend). ACP has no system field. */
  systemAppend?: string
  /** Builder mode: may edit files / run shell. Default false (read-only). */
  writeCapable?: boolean
  /** cwd the subtask operates in (the conversation's isolated workspace). */
  cwd: string
  /** Main-run id, so STOP/interrupt can kill this subtask's goose process. */
  runId?: string
  /** Optional progress callback (tool/text events) for the activity dashboard. */
  onEvent?: (e: ReturnType<typeof mapUpdate>) => void
}

export interface GooseSubtaskResult {
  output: string
  costUsd: number
  model: string
  /** Tokens used, from goose's `usage_update` stream notification (0 if none seen). */
  tokensUsed: number
}

/** Compose the prompt: ACP carries no system prompt, so prepend it (Octopal pattern). */
function composePrompt(opts: GooseSubtaskOptions): string {
  const parts: string[] = []
  const sys = [
    'You are a sub-agent executing ONE scoped, self-contained subtask delegated by an orchestrator.',
    'Answer directly; your final text is the deliverable.',
    opts.writeCapable
      ? 'You may read files, run commands, and edit files to complete the task; verify your work before finishing.'
      : 'You are read-only: do not attempt to modify files or run shell commands.',
    opts.systemAppend ?? ''
  ]
    .filter(Boolean)
    .join(' ')
  parts.push(`--- FORGE SUBTASK CONTEXT (treat as system instructions) ---\n${sys}\n--- END CONTEXT ---`)
  if (opts.context) parts.push(`Context from earlier work (read-only):\n${opts.context}`)
  parts.push(opts.instruction)
  return parts.join('\n\n')
}

export async function runGooseSubtask(opts: GooseSubtaskOptions): Promise<GooseSubtaskResult> {
  const bin = await resolveGooseBinary()
  const mode: GooseMode = opts.writeCapable ? 'auto' : 'approve'
  const env = buildGooseEnv(opts.provider, mode)

  let output = ''
  let tokensUsed = 0
  const onUpdate = (u: SessionUpdate): void => {
    const ev = mapUpdate(u)
    if (ev.kind === 'text') output += ev.text
    else if (ev.kind === 'usage') tokensUsed = ev.used || tokensUsed
    opts.onEvent?.(ev)
  }

  // Read-only gate: answer session/request_permission, allowing only read tools.
  const onServerRequest = (method: string, params: Record<string, unknown>): unknown => {
    if (method !== 'session/request_permission') return {}
    const allow = opts.writeCapable === true || requestedToolAllowed(params)
    return selectPermissionOption(params, allow)
  }

  // Cap concurrent goose processes (Claude may delegate several in parallel).
  // Construct the client INSIDE the try so a throw from `new AcpClient` (spawn)
  // can't leak the slot we just acquired.
  await acquireGooseSlot()
  const runId = opts.runId
  // STOP may have fired while this subtask was parked in the semaphore. If so, the
  // run is already dead — don't spawn a fresh goose process that would orphan and
  // run to goose's timeout. Release the slot we just took and bail.
  if (runId && isRunKilled(runId)) {
    releaseGooseSlot()
    throw new Error('Run was interrupted before this delegated subtask could start')
  }
  let client: AcpClient | undefined
  try {
    client = new AcpClient({ bin, cwd: opts.cwd, env, onUpdate, onServerRequest })
    if (runId) registerGooseClient(runId, client)
    await client.initialize()
    const sessionId = await client.sessionNew(opts.cwd)
    // 'auto' is already the default; only set when locking down.
    if (mode !== 'auto') await client.sessionSetMode(sessionId, mode)
    await client.sessionPrompt(sessionId, composePrompt(opts))
  } finally {
    client?.shutdown()
    if (runId && client) unregisterGooseClient(runId, client)
    releaseGooseSlot()
  }

  return {
    output: output.trim(),
    costUsd: 0, // free providers are genuinely $0 (tokens captured separately)
    model: `${opts.provider.gooseProvider}/${opts.provider.defaultModel}`,
    tokensUsed
  }
}

/**
 * True if the tool named in a permission request is read-only (fail closed).
 * Live shape (goose 1.37.0, verified 2026-06-16):
 *   params.toolCall = { toolCallId, kind, status, title:"write", rawInput,
 *                       _meta?:{goose:{toolCall:{toolName:"write", extensionName}}} }
 * The clean name is `toolCall.title` (or `_meta.goose.toolCall.toolName`); the old
 * code read `toolName`/`tool_name`/`toolCall.name` — none exist → it rejected
 * everything, including reads. We now read the real fields and classify via
 * `normalizeTool`.
 */
function requestedToolAllowed(params: Record<string, unknown>): boolean {
  const tc = (params.toolCall ?? params.tool_call) as Record<string, unknown> | undefined
  const meta = (tc?._meta as Record<string, unknown> | undefined)?.goose as
    | { toolCall?: { toolName?: unknown } }
    | undefined
  const metaName = typeof meta?.toolCall?.toolName === 'string' ? meta.toolCall.toolName : undefined
  const title = pluck(tc, 'title')?.split(' · ')[0].trim() // "write · path" → "write"
  const raw =
    metaName ?? title ?? pluck(params, 'toolName') ?? pluck(params, 'tool_name') ?? pluck(tc, 'name')
  if (!raw) return false // unknown tool → fail closed
  return READ_ONLY_LABELS.has(normalizeTool(raw))
}

function pluck(o: Record<string, unknown> | undefined, k: string): string | undefined {
  const v = o?.[k]
  return typeof v === 'string' ? v : undefined
}

/**
 * Build the ACP request_permission response selecting an allow/reject option.
 * ACP options carry a `kind` (allow_once/allow_always/reject_once/reject_always)
 * and an `optionId`. We pick the matching option; if none, cancel (fail closed).
 */
function selectPermissionOption(params: Record<string, unknown>, allow: boolean): unknown {
  const options = (params.options as Array<Record<string, unknown>> | undefined) ?? []
  const want = allow ? 'allow' : 'reject'
  const opt = options.find((o) => String(o.kind ?? '').includes(want))
  if (opt && opt.optionId !== undefined) {
    return { outcome: { outcome: 'selected', optionId: opt.optionId } }
  }
  return { outcome: { outcome: 'cancelled' } }
}
