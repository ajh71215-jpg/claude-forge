// Account capabilities probe (docs/MAINTAINABILITY.md Phase 4). Extracted
// verbatim from the former src/main/agent.ts.

import { toSdkMcpServers } from '../mcp'
import { toSdkPlugins } from '../plugins'
import { buildEnv, ensureWorkspace, SETTING_SOURCES } from './env'
import { idlePrompt } from './helpers'
import type { Capabilities, McpServer, ModelInfo, SlashCommand } from './types'

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
