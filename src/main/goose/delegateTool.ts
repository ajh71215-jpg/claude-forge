// The Plan A entry point (docs/GOOSE_INTEGRATION.md §3): an in-process MCP server
// exposing ONE tool — `delegate` — to the main chat run. The orchestrator Claude
// decides what to offload, writes the sub-prompt, and calls delegate(...); Forge
// routes it to a free model via goose and returns the result inline.
//
// Failures (no provider enabled / goose missing / quota) return an isError result
// so Claude can gracefully fall back to doing the work itself — never a hard stop.

import { z } from 'zod'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { enabledProviders } from '../providers'
import { orderProviders, type DelegateTier } from '../routing'
import { getRole } from '../roles'
import { gooseSubtaskFinish, gooseSubtaskStart, gooseSubtaskTool } from '../agentActivity'
import { runGooseSubtask } from './runGooseSubtask'
import { isProviderCoolingDown, noteProviderResult } from './quota'

/** A graceful tool-error result so Claude falls back to doing the task itself. */
function errResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true as const }
}

/**
 * Build the delegate MCP server, bound to a conversation's workspace cwd + the
 * main run's id (so delegated subtasks nest under that run in the Agents tab).
 */
export function buildDelegateServer(cwd: string, runId: string) {
  const delegate = tool(
    'delegate',
    'Delegate a self-contained, low-stakes subtask (summarize, draft, classify, ' +
      'simple edit, lookup, boilerplate) to a FREE model to save budget. Provide a ' +
      'COMPLETE, standalone instruction — the sub-agent has no chat history or your ' +
      'context. It can read files and (if writeCapable) edit them within the workspace. ' +
      'Always verify the returned result yourself before relying on it. If it reports ' +
      'no provider available or an error, just do the task yourself.',
    {
      instruction: z.string().describe('The complete, standalone task for the sub-agent.'),
      tier: z
        .enum(['free', 'cheap', 'auto'])
        .optional()
        .describe("'free' forces a free model; 'auto' (default) only delegates easy work."),
      role: z
        .string()
        .optional()
        .describe('Optional Forge role persona (e.g. explore, writer, executor).'),
      writeCapable: z
        .boolean()
        .optional()
        .describe('Allow the sub-agent to edit files / run commands. Default false (read-only).')
    },
    async (args) => {
      const tier: DelegateTier = args.tier ?? 'auto'
      const providers = await enabledProviders()
      // Ordered candidates (free first); skip any cooling down from a recent 429/quota.
      const order = orderProviders(
        tier,
        args.instruction,
        providers.map((p) => ({ id: p.id, free: p.free }))
      )
      if (!order.length) {
        return errResult(
          providers.length === 0
            ? 'No free provider is configured. Do this task yourself.'
            : 'This task is not a good fit for a free model. Do it yourself.'
        )
      }
      const candidates = order.filter((id) => !isProviderCoolingDown(id))
      if (!candidates.length) {
        return errResult(
          'All free providers are rate-limited / cooling down right now. Do this task yourself.'
        )
      }

      const role = getRole(args.role)
      const writeCapable = args.writeCapable ?? role?.writeCapable ?? false
      let lastError = ''

      // Quota/429 fallback: try each provider in turn; a provider-side failure
      // (rate/quota/auth/unavailable) cools it down and falls through to the next;
      // a task-level error stops the loop (don't burn other providers' quota).
      for (const id of candidates) {
        const provider = providers.find((p) => p.id === id)!
        const activityId = gooseSubtaskStart(
          runId,
          `🪿 ${provider.gooseProvider}${args.role ? ` · ${args.role}` : ''}`,
          args.instruction
        )
        try {
          const res = await runGooseSubtask({
            instruction: args.instruction,
            provider,
            systemAppend: role?.systemAppend,
            writeCapable,
            cwd,
            runId,
            onEvent: (ev) => {
              if (ev.kind === 'tool') gooseSubtaskTool(activityId, ev.tool, ev.target, ev.status)
            }
          })
          noteProviderResult(id, true)
          gooseSubtaskFinish(activityId, 'ok', { tokensUsed: res.tokensUsed })
          const text = res.output || '(the sub-agent returned no text)'
          return {
            content: [{ type: 'text' as const, text: `[delegated → ${res.model}]\n\n${text}` }]
          }
        } catch (e) {
          const msg = String(e)
          lastError = msg
          const cls = noteProviderResult(id, false, msg)
          gooseSubtaskFinish(activityId, 'error', { detail: `${cls.kind}: ${msg.slice(0, 100)}` })
          if (!cls.retriable) break // task-level error → other providers won't help
        }
      }
      return errResult(
        `Delegation failed across free providers (${lastError.slice(0, 160)}). Do this task yourself.`
      )
    }
  )

  return createSdkMcpServer({ name: 'forge', version: '1.0.0', tools: [delegate] })
}
