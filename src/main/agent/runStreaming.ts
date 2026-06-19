// Streaming-input runner with live controls (docs/MAINTAINABILITY.md Phase 4).
// Extracted verbatim from the former src/main/agent.ts — the runId-keyed
// concurrency logic (active Map, pending* drains) is moved, not changed.
//
// Each prompt runs as a streaming-input query (prompt = async iterable yielding
// one user message), which is what unlocks q.interrupt() (STOP). Model, effort
// and permission mode are passed as per-prompt options, so no runtime setters
// are needed. ASK maps to permissionMode 'default' + a canUseTool callback that
// round-trips to the renderer for approval.

import { type WebContents } from 'electron'
import { getPersona, personaToSystemPrompt } from '../persona'
import { resolveSkillsOption } from '../skills'
import { toSdkMcpServers } from '../mcp'
import { toSdkPlugins } from '../plugins'
import { enabledProviders } from '../providers'
import { buildDelegateServer } from '../goose/delegateTool'
import { buildEnv, ensureWorkspace, ensureResumeCwd, SETTING_SOURCES } from './env'
import { getSessionCwd } from './sessions'
import { resultErrorMessage, singlePrompt, toolContentToString } from './helpers'
import { active, pendingDialogs, pendingPerms } from './state'
import { emitAgentEvent } from '../pet/bus'
import { buildMemoryInjection, noteRunWorkspace } from '../memory'
import { buildRepoMapInjection } from '../repomap'
import { buildRetrievalInjection } from '../retrieval'
import { estimateTokens } from '../efficiency/compress'
import type { ActiveQuery, AgentEvent, AgentEventBody, QuestionResult, RunOptions } from './types'

export async function runStreaming(
  sender: WebContents,
  runId: string,
  prompt: string,
  opts: RunOptions = {}
): Promise<void> {
  const send = (payload: AgentEventBody): void => {
    const event = { runId, ...payload } as AgentEvent
    if (!sender.isDestroyed()) sender.send('agent:event', event)
    // Tap for the desktop pet (no-op when the pet has no listeners).
    emitAgentEvent(event)
  }

  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const env = await buildEnv()
  // Resolve the run's cwd:
  //  - Resuming → the SDK locates a session by the project key derived from cwd,
  //    so the run MUST happen in the exact dir the session was recorded under.
  //    The renderer's workspaceId can be wrong here (a session predating workspace
  //    isolation, or whose session→ws map was lost on restart → a random fallback
  //    key), which is why the transcript loads but a follow-up turn errored. Anchor
  //    to the session's recorded cwd when known.
  //  - Otherwise → the tab's isolated per-conversation workspace (workspaceId), so
  //    concurrent conversations don't edit the same files; else the shared root.
  const recordedCwd = opts.resume ? await getSessionCwd(opts.resume) : undefined
  const cwd = recordedCwd
    ? await ensureResumeCwd(recordedCwd)
    : await ensureWorkspace(opts.workspaceId)

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
  // console), passed programmatically rather than via project `.claude/`. The
  // per-conversation scope (opts.mcpScope) trims which servers load this run so a
  // chat doesn't pay the per-turn tool-definition tax for servers it never uses
  // (docs/TOKEN_OPTIMIZATION.md §10); undefined ⇒ all (unchanged default).
  const mcpServers = await toSdkMcpServers(opts.mcpScope)

  // Free-provider delegation (docs/GOOSE_INTEGRATION.md): when ≥1 provider is
  // enabled, expose the in-process `delegate` tool so the orchestrator can offload
  // simple subtasks to a free model via goose. Configuring a provider is the
  // opt-in. The handler can run >60s, so raise the SDK stream-close timeout.
  if ((await enabledProviders()).length) {
    mcpServers.forge = buildDelegateServer(cwd, runId) as unknown as Record<string, unknown>
    if (!env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT) env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '600000'
  }

  if (Object.keys(mcpServers).length) options.mcpServers = mcpServers

  // Plugins (roadmap #6): local plugin bundles registered in the EXTEND console.
  const plugins = await toSdkPlugins()
  if (plugins.length) options.plugins = plugins

  // Orchestration (docs/SQUAD_ORCHESTRATION.md §6): named subagents the lead may
  // delegate to via Task. Additive — absent ⇒ no delegation, behavior unchanged.
  if (opts.agents && Object.keys(opts.agents).length) options.agents = opts.agents

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

  // Persistent project memory (docs: agentmemory absorption). On a FRESH
  // conversation (not a resume), recall the most relevant captured facts and
  // prepend them — compressed, budget-bounded — so the agent doesn't re-derive
  // what earlier sessions already established. Only on the first turn, so the
  // injected block never churns the prompt cache mid-conversation. Capture (the
  // reverse direction) runs globally via initMemoryCapture(); we just tag this
  // run's workspace so captured facts are scoped.
  noteRunWorkspace(runId, opts.workspaceId)
  let effectivePrompt = prompt
  let injectedTokens = 0
  if (!opts.resume) {
    // Both are no-ops until there's something to inject (empty memory / empty
    // workspace), and both are budget-bounded + compressed. Repo map first
    // (stable structure), then recalled memory (query-relevant facts).
    const blocks: string[] = []
    const repo = await buildRepoMapInjection(cwd)
    if (repo.text) blocks.push(repo.text)
    // RAG (docs/TOKEN_OPTIMIZATION.md §11): top-k workspace content chunks relevant
    // to the prompt. Naturally gated — injects nothing when the query has no term
    // overlap — so it complements the structural repo map with actual code passages.
    const rag = await buildRetrievalInjection(cwd, prompt)
    if (rag.text) blocks.push(rag.text)
    const mem = await buildMemoryInjection(prompt, { workspaceId: opts.workspaceId })
    if (mem.text) blocks.push(mem.text)
    if (blocks.length) {
      const injected = blocks.join('\n\n')
      injectedTokens = estimateTokens(injected)
      effectivePrompt = `${injected}\n\n${prompt}`
    }
  }

  const q: any = query({ prompt: singlePrompt(effectivePrompt, opts.attachments), options } as any)
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
      if (msg.type === 'system') {
        // Native subagent (Task) lifecycle + reliability signals. All already
        // emitted by the SDK — no extra tokens; Forge just surfaces them.
        if (msg.subtype === 'init') {
          send({ type: 'system', model: msg.model })
        } else if (msg.subtype === 'task_started' && !msg.skip_transcript) {
          send({
            type: 'task-started',
            taskId: msg.task_id,
            toolUseId: msg.tool_use_id,
            subagentType: msg.subagent_type,
            description: msg.description
          })
        } else if (msg.subtype === 'task_progress') {
          send({
            type: 'task-progress',
            taskId: msg.task_id,
            toolUseId: msg.tool_use_id,
            subagentType: msg.subagent_type,
            totalTokens: msg.usage?.total_tokens,
            toolUses: msg.usage?.tool_uses,
            durationMs: msg.usage?.duration_ms
          })
        } else if (msg.subtype === 'task_updated') {
          send({
            type: 'task-updated',
            taskId: msg.task_id,
            status: msg.patch?.status,
            description: msg.patch?.description,
            error: msg.patch?.error
          })
        } else if (msg.subtype === 'task_notification') {
          send({
            type: 'task-done',
            taskId: msg.task_id,
            toolUseId: msg.tool_use_id,
            status: msg.status,
            summary: msg.summary,
            totalTokens: msg.usage?.total_tokens,
            toolUses: msg.usage?.tool_uses,
            durationMs: msg.usage?.duration_ms
          })
        } else if (msg.subtype === 'api_retry') {
          send({
            type: 'api-retry',
            attempt: msg.attempt,
            maxRetries: msg.max_retries,
            retryDelayMs: msg.retry_delay_ms,
            errorStatus: msg.error_status
          })
        } else if (msg.subtype === 'compact_boundary') {
          send({
            type: 'compact-boundary',
            trigger: msg.compact_metadata?.trigger ?? 'auto',
            preTokens: msg.compact_metadata?.pre_tokens,
            postTokens: msg.compact_metadata?.post_tokens
          })
        }
      } else if (msg.type === 'stream_event') {
        const ev = msg.event
        // parent_tool_use_id is set on subagent stream events → attribute the
        // block to the spawning Task instead of the lead (Agents dashboard).
        const parentToolId = (msg.parent_tool_use_id ?? null) as string | null
        if (ev?.type === 'message_start') {
          turn += 1
          streamed = false
        } else if (ev?.type === 'content_block_start') {
          streamed = true
          const cb = ev.content_block
          if (cb?.type === 'text')
            send({ type: 'block-start', blockId: bid(ev.index), kind: 'text', parentToolId })
          else if (cb?.type === 'thinking')
            send({ type: 'block-start', blockId: bid(ev.index), kind: 'thinking', parentToolId })
          else if (cb?.type === 'tool_use')
            send({
              type: 'block-start',
              blockId: bid(ev.index),
              kind: 'tool',
              name: cb.name,
              toolId: cb.id,
              parentToolId
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
        const parentToolId = (msg.parent_tool_use_id ?? null) as string | null
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b?.type === 'tool_result') {
              send({
                type: 'tool-result',
                toolId: b.tool_use_id,
                ok: !b.is_error,
                content: toolContentToString(b.content),
                parentToolId
              })
            }
          }
        }
      } else if (msg.type === 'tool_progress') {
        send({
          type: 'tool-progress',
          toolUseId: msg.tool_use_id,
          toolName: msg.tool_name,
          parentToolId: (msg.parent_tool_use_id ?? null) as string | null,
          elapsedSeconds: msg.elapsed_time_seconds ?? 0
        })
      } else if (msg.type === 'rate_limit_event') {
        const ri = msg.rate_limit_info ?? {}
        send({
          type: 'rate-limit',
          status: ri.status ?? 'allowed',
          utilization: ri.utilization,
          rateLimitType: ri.rateLimitType,
          resetsAt: ri.resetsAt
        })
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
          cacheWriteTokens: u?.cache_creation_input_tokens,
          injectedTokens: injectedTokens || undefined,
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
