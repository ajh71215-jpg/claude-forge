// Agent module types (docs/MAINTAINABILITY.md Phase 4). Extracted verbatim from
// the former src/main/agent.ts — behavior-preserving. Leaf module: no imports, so
// it can't introduce an import cycle.

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Permission = 'plan' | 'ask' | 'acceptEdits' | 'bypassPermissions'

/**
 * Subset of the SDK `AgentDefinition` (node_modules/@anthropic-ai/
 * claude-agent-sdk/sdk.d.ts) that Forge passes through for orchestrator-worker
 * delegation (docs/SQUAD_ORCHESTRATION.md). Structurally assignable to the SDK
 * type; extra SDK fields are simply not set by Forge.
 */
export interface AgentDefinition {
  /** When the lead should delegate to this agent. */
  description: string
  /** The subagent's system prompt. */
  prompt: string
  /** Model alias ('haiku'|'sonnet'|'opus') or full id; omit/'inherit' = main. */
  model?: string
  /** Allowed tool names; omit to inherit all from the parent (context isolation). */
  tools?: string[]
}

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
  /**
   * Named subagents the lead may delegate to via the Task tool (SDK `agents`
   * option). Enables orchestrator-worker topologies. Omitted → no delegation,
   * i.e. identical to current behavior. (docs/SQUAD_ORCHESTRATION.md §6)
   */
  agents?: Record<string, AgentDefinition>
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
      /** cache_creation_input_tokens — the write side of prompt caching, for the
       * cache hit % metric (docs/TOKEN_OPTIMIZATION.md §3 lever 1). */
      cacheWriteTokens?: number
      error?: string
    }

export type PermissionResult =
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
export type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never
export type AgentEventBody = DistributiveOmit<AgentEvent, 'runId'>

/** Minimal interface for an in-flight SDK query (only the methods Forge uses). */
export interface ActiveQuery {
  interrupt(): Promise<void>
  close?(): void
}
