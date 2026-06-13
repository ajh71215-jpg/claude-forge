import { type WebContents } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { resolveAuthEnv } from './auth'
import { getPersona, personaToSystemPrompt } from './persona'
import { resolveSkillsOption } from './skills'
import { toSdkMcpServers } from './mcp'
import { toSdkPlugins } from './plugins'
import { workspaceRoot } from './projectSettings'

export type { Persona, PersonaMode } from './persona'

/**
 * Step 5 — streaming-input runner with live controls.
 *
 * Each prompt runs as a streaming-input query (prompt = async iterable yielding
 * one user message), which is what unlocks q.interrupt() (STOP). Model, effort
 * and permission mode are passed as per-prompt options, so no runtime setters
 * are needed. ASK maps to permissionMode 'default' + a canUseTool callback that
 * round-trips to the renderer for approval.
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Permission = 'plan' | 'ask' | 'acceptEdits' | 'bypassPermissions'

export interface RunOptions {
  effort?: Effort
  model?: string
  permission?: Permission
  /** Resume an existing conversation (session id) for multi-turn continuity. */
  resume?: string
  /** Images to attach to the prompt (sent as base64 content blocks). */
  attachments?: Attachment[]
  /** Cap agent loop iterations (token/runaway guard). */
  maxTurns?: number
  /** Hard per-run cost ceiling in USD; the run stops when exceeded. */
  maxBudgetUsd?: number
  /** Per-run system prompt (per-agent persona). Overrides the global persona. */
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string }
}

export interface SessionInfo {
  sessionId: string
  title: string
  firstPrompt?: string
  lastModified?: number
}

export interface ModelInfo {
  value: string
  displayName: string
  description?: string
  supportedEffortLevels?: string[]
}

export interface SlashCommand {
  name: string
  description?: string
  argumentHint?: string
  aliases?: string[]
}

export interface McpServer {
  name: string
  status: string
  url?: string
}

export interface AccountInfo {
  email?: string
  subscriptionType?: string
}

export interface Capabilities {
  models: ModelInfo[]
  commands: SlashCommand[]
  mcpServers: McpServer[]
  account?: AccountInfo
}

export interface UsageEntry {
  label: string
  percent: number
  resets: string
}

export interface UsageInfo {
  entries: UsageEntry[]
  raw: string
}

export interface Attachment {
  mediaType: string
  base64: string
}

export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | {
      kind: 'tool'
      toolId: string
      name: string
      input: unknown
      status: 'running' | 'ok' | 'error'
      result?: string
    }

export type AgentEvent =
  | { runId: string; type: 'system'; model?: string }
  | { runId: string; type: 'session'; sessionId: string }
  | {
      runId: string
      type: 'block-start'
      blockId: string
      kind: 'text' | 'thinking' | 'tool'
      name?: string
      toolId?: string
    }
  | { runId: string; type: 'block-delta'; blockId: string; text: string }
  | { runId: string; type: 'tool-input'; blockId: string; partialJson: string }
  | { runId: string; type: 'block-stop'; blockId: string }
  | { runId: string; type: 'tool-result'; toolId: string; ok: boolean; content: string }
  | {
      runId: string
      type: 'permission'
      id: string
      toolName: string
      input: Record<string, unknown>
    }
  | {
      /**
       * A `request_user_dialog` from the subprocess (e.g. the AskUserQuestion
       * tool surfaces as dialogKind 'permission_ask_user_question'). The renderer
       * shows an interactive UI and replies via respondDialog.
       */
      runId: string
      type: 'dialog'
      id: string
      dialogKind: string
      payload: Record<string, unknown>
      toolUseID?: string
    }
  | {
      runId: string
      type: 'result'
      ok: boolean
      costUsd?: number
      durationMs?: number
      inputTokens?: number
      outputTokens?: number
      contextTokens?: number
      cacheReadTokens?: number
      error?: string
    }

type PermissionResult =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message: string }

/**
 * Reply to an AskUserQuestion prompt. This is an SDK PermissionResult: on allow
 * the chosen answers ride along in `updatedInput` (the tool reads them from
 * `updatedInput.answers`); on deny the run continues without an answer.
 */
export type QuestionResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

/** Omit that distributes over a union, so each member keeps its own fields. */
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never
type AgentEventBody = DistributiveOmit<AgentEvent, 'runId'>

/** Minimal interface for an in-flight SDK query (only the methods Forge uses). */
interface ActiveQuery {
  interrupt(): Promise<void>
  close?(): void
}

// Active queries (for STOP), pending ASK prompts, and pending question prompts.
const active = new Map<string, ActiveQuery>()
const pendingPerms = new Map<string, (r: PermissionResult) => void>()
const pendingDialogs = new Map<string, (r: QuestionResult) => void>()

/**
 * An async generator that never yields — used to keep a query stream open for
 * control-method probing (getCapabilities) without submitting any prompt.
 */
async function* idlePrompt(): AsyncGenerator<never> {
  await new Promise<void>(() => {})
}

/** Build the subprocess env, applying auth overrides (undefined = delete). */
async function buildEnv(): Promise<Record<string, string>> {
  const env: Record<string, string | undefined> = { ...process.env }
  const overrides = await resolveAuthEnv()
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  return Object.fromEntries(
    Object.entries(env).filter(([, v]) => v != null)
  ) as Record<string, string>
}

/**
 * Phase 0 — filesystem `.claude/` discovery.
 *
 * The SDK only finds project Skills / Commands / Agents / hooks / MCP when it is
 * (a) told which setting sources to read and (b) given a cwd whose `.claude/` is
 * the source of truth. process.cwd() is unreliable for this: in a packaged build
 * it's the (often read-only) install dir, and `~` is wiped on reboot on this
 * machine. So Forge anchors a stable, writable workspace under userData and
 * treats its `.claude/` as the project root for every run.
 *
 * 'user' + 'project' mirror the CLI defaults; 'local' is intentionally omitted.
 */
const SETTING_SOURCES = ['user', 'project'] as const

let workspaceReady: Promise<string> | null = null

/**
 * Path to Forge's persistent project workspace (its `.claude/` lives here).
 * @deprecated Import workspaceRoot from './projectSettings' directly.
 */
export function workspaceDir(): string {
  return workspaceRoot()
}

/**
 * Create the workspace and its `.claude/` skill/command/agent dirs once, then
 * reuse the cached result. Best-effort: the SDK tolerates a missing `.claude/`,
 * so a mkdir failure still yields a usable cwd.
 */
function ensureWorkspace(): Promise<string> {
  if (!workspaceReady) {
    const dir = workspaceRoot()
    const claude = join(dir, '.claude')
    workspaceReady = Promise.all([
      fs.mkdir(join(claude, 'skills'), { recursive: true }),
      fs.mkdir(join(claude, 'commands'), { recursive: true }),
      fs.mkdir(join(claude, 'agents'), { recursive: true })
    ])
      .then(() => dir)
      .catch(() => dir)
  }
  return workspaceReady
}

function resultErrorMessage(subtype: string): string {
  switch (subtype) {
    case 'error_max_turns':
      return 'Stopped: max turns reached (raise the limit to continue).'
    case 'error_max_budget_usd':
      return 'Stopped: per-run budget limit reached.'
    case 'error_during_execution':
      return 'The run ended with an execution error.'
    default:
      return subtype
  }
}

function toolContentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === 'string' ? c : c?.type === 'text' ? c.text : JSON.stringify(c)))
      .join('\n')
  }
  return content == null ? '' : JSON.stringify(content)
}

async function* singlePrompt(prompt: string, attachments?: Attachment[]): AsyncGenerator<any> {
  const content =
    attachments && attachments.length
      ? [
          { type: 'text', text: prompt },
          ...attachments.map((a) => ({
            type: 'image',
            source: { type: 'base64', media_type: a.mediaType, data: a.base64 }
          }))
        ]
      : prompt
  yield {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null
  }
}

/** Resolve a pending ASK prompt with the renderer's decision. */
export function respondPermission(id: string, allow: boolean): void {
  const resolve = pendingPerms.get(id)
  if (resolve) {
    pendingPerms.delete(id)
    resolve(allow ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied in Forge' })
  }
}

/** Resolve a pending AskUserQuestion prompt with the renderer's answer. */
export function respondDialog(id: string, result: QuestionResult): void {
  const resolve = pendingDialogs.get(id)
  if (resolve) {
    pendingDialogs.delete(id)
    resolve(result)
  }
}

/** STOP — interrupt the active run. */
export async function interruptRun(runId: string): Promise<void> {
  const q = active.get(runId)
  if (q) {
    try {
      await q.interrupt()
    } catch {
      /* already finishing */
    }
  }
}

/**
 * One-shot: list the models and slash commands available to this account.
 * The control methods resolve directly — do NOT iterate the stream (an idle
 * input never emits init, which would hang).
 */
export async function getCapabilities(): Promise<Capabilities> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const env = await buildEnv()
  const cwd = await ensureWorkspace()
  const mcpServers = await toSdkMcpServers()
  const plugins = await toSdkPlugins()
  // Same setting sources as a real run, so project `.claude/` commands and MCP
  // servers show up in supportedCommands()/mcpServerStatus(). The idle prompt
  // submits nothing, so no UserPromptSubmit/Stop hooks fire during this probe.
  const q: any = query({
    prompt: idlePrompt(),
    options: {
      env,
      cwd,
      settingSources: [...SETTING_SOURCES],
      persistSession: false,
      ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
      ...(plugins.length ? { plugins } : {})
    }
  } as any)
  try {
    const [models, commands, mcp, account] = await Promise.all([
      q.supportedModels(),
      q.supportedCommands(),
      q.mcpServerStatus(),
      q.accountInfo().catch(() => undefined)
    ])
    const mcpServers: McpServer[] = (mcp ?? []).map((s: any) => ({
      name: s.name,
      status: s.status,
      url: s.config?.url
    }))
    return {
      models: models as ModelInfo[],
      commands: commands as SlashCommand[],
      mcpServers,
      account: account
        ? { email: account.email, subscriptionType: account.subscriptionType }
        : undefined
    }
  } catch {
    return { models: [], commands: [], mcpServers: [] }
  } finally {
    try {
      q.close?.()
    } catch {
      /* ignore */
    }
  }
}

/** Compact a conversation to shrink its context. Keeps the same session id. */
export async function compactSession(
  sessionId: string
): Promise<{ ok: boolean; sessionId: string; error?: string }> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const env = await buildEnv()
  const cwd = await ensureWorkspace()
  let sid = sessionId
  let ok = false
  let error: string | undefined
  try {
    // cwd must match the run that created the session, or resume can't locate it.
    const q: any = query({
      prompt: '/compact',
      options: {
        permissionMode: 'bypassPermissions',
        maxTurns: 1,
        resume: sessionId,
        env,
        cwd
      } as any
    })
    for await (const msg of q as AsyncIterable<any>) {
      if (msg.session_id) sid = msg.session_id
      if (msg.type === 'result') ok = msg.subtype === 'success'
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  return { ok, sessionId: sid, error }
}

/** Subscription usage (% used per window) parsed from the /usage command. */
export async function getUsage(): Promise<UsageInfo> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const env = await buildEnv()
  let text = ''
  try {
    const q: any = query({
      prompt: '/usage',
      options: { permissionMode: 'bypassPermissions', maxTurns: 1, env, persistSession: false } as any
    })
    for await (const msg of q as AsyncIterable<any>) {
      if (msg.type === 'assistant') {
        for (const b of msg.message?.content ?? []) if (b.type === 'text') text += b.text
      }
    }
  } catch {
    /* offline / error */
  }
  const entries: UsageEntry[] = []
  const re = /Current ([^:]+):\s*(\d+)%\s*used\s*·\s*resets\s*([^\n]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    entries.push({ label: m[1].trim(), percent: Number(m[2]), resets: m[3].trim() })
  }
  return { entries, raw: text.trim() }
}

/** Reconstruct a past conversation's transcript for display. */
export async function getTranscript(sessionId: string): Promise<TranscriptItem[]> {
  const sdk: any = await import('@anthropic-ai/claude-agent-sdk')
  try {
    const msgs: any[] = (await sdk.getSessionMessages(sessionId)) ?? []
    const items: TranscriptItem[] = []
    const toolIndex = new Map<string, Extract<TranscriptItem, { kind: 'tool' }>>()
    for (const m of msgs) {
      const role = m.message?.role
      const content = m.message?.content
      if (role === 'user') {
        if (typeof content === 'string') {
          const t = content.trim()
          // Skip harness/system-tagged messages (<command-name>, <system-reminder>…).
          if (t && !t.startsWith('<')) items.push({ kind: 'user', text: t })
        } else if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type === 'tool_result') {
              const tool = toolIndex.get(b.tool_use_id)
              if (tool) {
                tool.status = b.is_error ? 'error' : 'ok'
                tool.result = toolContentToString(b.content)
              }
            } else if (b.type === 'text') {
              const t = (b.text ?? '').trim()
              if (t && !t.startsWith('<')) items.push({ kind: 'user', text: t })
            }
          }
        }
      } else if (role === 'assistant' && Array.isArray(content)) {
        for (const b of content) {
          if (b.type === 'text' && (b.text ?? '').trim()) {
            items.push({ kind: 'text', text: b.text })
          } else if (b.type === 'thinking' && (b.thinking ?? '').trim()) {
            items.push({ kind: 'thinking', text: b.thinking })
          } else if (b.type === 'tool_use') {
            const item: Extract<TranscriptItem, { kind: 'tool' }> = {
              kind: 'tool',
              toolId: b.id,
              name: b.name,
              input: b.input,
              status: 'ok'
            }
            items.push(item)
            toolIndex.set(b.id, item)
          }
        }
      }
    }
    return items.slice(-300)
  } catch {
    return []
  }
}

/** Recent conversations for this project (cwd), newest first. */
export async function getSessions(): Promise<SessionInfo[]> {
  const sdk: any = await import('@anthropic-ai/claude-agent-sdk')
  try {
    const all: any[] = (await sdk.listSessions()) ?? []
    // Runs are anchored to the Forge workspace (see ensureWorkspace), so match
    // sessions to it — not process.cwd(), which differs in dev vs packaged.
    const cwd = workspaceDir()
    return all
      .filter((s) => !s.cwd || s.cwd === cwd)
      // Hide internal/utility sessions (usage probes, empty capability queries).
      .filter((s) => {
        const fp = (s.firstPrompt ?? '').trim()
        return fp && !fp.startsWith('/usage') && !fp.startsWith('/context') && !fp.startsWith('/compact')
      })
      .map((s) => ({
        sessionId: s.sessionId,
        title: s.customTitle || s.summary || s.firstPrompt || s.sessionId,
        firstPrompt: s.firstPrompt,
        lastModified: s.lastModified
      }))
      .sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0))
      .slice(0, 25)
  } catch {
    return []
  }
}

export async function runStreaming(
  sender: WebContents,
  runId: string,
  prompt: string,
  opts: RunOptions = {}
): Promise<void> {
  const send = (payload: AgentEventBody): void => {
    if (!sender.isDestroyed()) sender.send('agent:event', { runId, ...payload } as AgentEvent)
  }

  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const env = await buildEnv()
  const cwd = await ensureWorkspace()

  // Phase 0: read the filesystem `.claude/` (skills · commands · agents ·
  // settings · hooks · mcp). Without settingSources the SDK runs hermetic and
  // ignores all of it.
  const options: Record<string, unknown> = {
    includePartialMessages: true,
    env,
    cwd,
    settingSources: [...SETTING_SOURCES]
  }
  if (opts.effort) options.effort = opts.effort
  if (opts.model) options.model = opts.model
  if (opts.resume) options.resume = opts.resume
  if (opts.maxTurns && opts.maxTurns > 0) options.maxTurns = opts.maxTurns
  if (opts.maxBudgetUsd && opts.maxBudgetUsd > 0) options.maxBudgetUsd = opts.maxBudgetUsd

  // Skills (roadmap #1): turn the user's authored `.claude/skills` on, honoring
  // the per-skill enable toggles. null = no authored skills → leave default.
  const skills = await resolveSkillsOption()
  if (skills) options.skills = skills

  // MCP (roadmap #4): Forge owns these connections (configured in the EXTEND
  // console), passed programmatically rather than via project `.claude/`.
  const mcpServers = await toSdkMcpServers()
  if (Object.keys(mcpServers).length) options.mcpServers = mcpServers

  // Plugins (roadmap #6): local plugin bundles registered in the EXTEND console.
  const plugins = await toSdkPlugins()
  if (plugins.length) options.plugins = plugins

  // A per-agent system prompt (squad) overrides the global persona; otherwise
  // fall back to the user's global persona.
  const systemPrompt = opts.systemPrompt ?? personaToSystemPrompt(await getPersona())
  if (systemPrompt !== undefined) options.systemPrompt = systemPrompt

  options.permissionMode =
    opts.permission === 'ask' ? 'default' : (opts.permission ?? 'bypassPermissions')

  // A single canUseTool handles two things:
  //  1. AskUserQuestion — the model's interactive question tool. It is delivered
  //     through canUseTool (NOT onUserDialog), and fires even under
  //     bypassPermissions, so we must always provide this callback. The answer is
  //     returned as { behavior:'allow', updatedInput: { ...input, answers } } where
  //     answers maps each question string to the chosen label(s).
  //  2. Normal permission prompts — only in ASK mode; other modes auto-allow
  //     (preserving bypass/plan/acceptEdits behavior).
  let permCounter = 0
  options.canUseTool = async (
    toolName: string,
    input: Record<string, unknown>
  ): Promise<QuestionResult> => {
    if (toolName === 'AskUserQuestion') {
      const id = `${runId}:q:${permCounter++}`
      return await new Promise<QuestionResult>((resolve) => {
        pendingDialogs.set(id, resolve)
        send({
          type: 'dialog',
          id,
          dialogKind: 'permission_ask_user_question',
          payload: { questions: Array.isArray(input.questions) ? input.questions : [] }
        })
      })
    }
    if (opts.permission === 'ask') {
      const id = `${runId}:${permCounter++}`
      return await new Promise<QuestionResult>((resolve) => {
        pendingPerms.set(id, (r) =>
          resolve(
            r.behavior === 'allow'
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: r.message }
          )
        )
        send({ type: 'permission', id, toolName, input })
      })
    }
    return { behavior: 'allow', updatedInput: input }
  }

  const q: any = query({ prompt: singlePrompt(prompt, opts.attachments), options } as any)
  active.set(runId, q as ActiveQuery)

  let turn = 0
  let sessionSent = false
  // Did the current assistant message stream content as partial deltas? Local
  // slash commands (/context, /cost, …) reply with a complete assistant message
  // and no stream_events, so we synthesize block events for those (see below).
  let streamed = false
  let synTurn = 0
  const bid = (index: number): string => `${turn}:${index}`

  try {
    for await (const msg of q as AsyncIterable<any>) {
      if (msg.session_id && !sessionSent) {
        sessionSent = true
        send({ type: 'session', sessionId: msg.session_id })
      }
      if (msg.type === 'system' && msg.subtype === 'init') {
        send({ type: 'system', model: msg.model })
      } else if (msg.type === 'stream_event') {
        const ev = msg.event
        if (ev?.type === 'message_start') {
          turn += 1
          streamed = false
        } else if (ev?.type === 'content_block_start') {
          streamed = true
          const cb = ev.content_block
          if (cb?.type === 'text') send({ type: 'block-start', blockId: bid(ev.index), kind: 'text' })
          else if (cb?.type === 'thinking')
            send({ type: 'block-start', blockId: bid(ev.index), kind: 'thinking' })
          else if (cb?.type === 'tool_use')
            send({
              type: 'block-start',
              blockId: bid(ev.index),
              kind: 'tool',
              name: cb.name,
              toolId: cb.id
            })
        } else if (ev?.type === 'content_block_delta') {
          const d = ev.delta
          if (d?.type === 'text_delta')
            send({ type: 'block-delta', blockId: bid(ev.index), text: d.text })
          else if (d?.type === 'thinking_delta')
            send({ type: 'block-delta', blockId: bid(ev.index), text: d.thinking })
          else if (d?.type === 'input_json_delta')
            send({ type: 'tool-input', blockId: bid(ev.index), partialJson: d.partial_json })
        } else if (ev?.type === 'content_block_stop') {
          send({ type: 'block-stop', blockId: bid(ev.index) })
        }
      } else if (msg.type === 'assistant') {
        // A complete assistant message. For normal turns its blocks already
        // streamed via deltas (streamed === true) so we ignore it. Local slash
        // commands and other non-streamed replies arrive only here — synthesize
        // block events so they render instead of showing an empty turn.
        if (!streamed) {
          const content = msg.message?.content
          if (Array.isArray(content)) {
            content.forEach((b: any, i: number) => {
              const blockId = `syn:${synTurn}:${i}`
              const text = b?.type === 'text' ? b.text : b?.type === 'thinking' ? b.thinking : ''
              if ((b?.type === 'text' || b?.type === 'thinking') && (text ?? '').length) {
                send({ type: 'block-start', blockId, kind: b.type })
                send({ type: 'block-delta', blockId, text })
                send({ type: 'block-stop', blockId })
              }
            })
            synTurn += 1
          }
        }
      } else if (msg.type === 'user') {
        const content = msg.message?.content
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b?.type === 'tool_result') {
              send({
                type: 'tool-result',
                toolId: b.tool_use_id,
                ok: !b.is_error,
                content: toolContentToString(b.content)
              })
            }
          }
        }
      } else if (msg.type === 'result') {
        const ok = msg.subtype === 'success'
        const u = msg.usage
        const contextTokens = u
          ? (u.input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0)
          : undefined
        send({
          type: 'result',
          ok,
          costUsd: msg.total_cost_usd,
          durationMs: msg.duration_ms,
          inputTokens: u?.input_tokens,
          outputTokens: u?.output_tokens,
          contextTokens,
          cacheReadTokens: u?.cache_read_input_tokens,
          error: ok ? undefined : resultErrorMessage(msg.subtype)
        })
      }
    }
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    let msg = raw
    if (/maximum budget/i.test(raw)) msg = 'Stopped: per-run budget limit reached.'
    else if (/maximum number/i.test(raw)) msg = 'Stopped: max turns reached (raise the limit to continue).'
    send({ type: 'result', ok: false, error: msg })
  } finally {
    active.delete(runId)
    // Resolve any dangling ASK prompts for this run as denied.
    for (const [id, resolve] of pendingPerms) {
      if (id.startsWith(`${runId}:`)) {
        pendingPerms.delete(id)
        resolve({ behavior: 'deny', message: 'Run ended' })
      }
    }
    // Deny any unanswered question prompts for this run.
    for (const [id, resolve] of pendingDialogs) {
      if (id.startsWith(`${runId}:`)) {
        pendingDialogs.delete(id)
        resolve({ behavior: 'deny', message: 'Run ended' })
      }
    }
  }
}
