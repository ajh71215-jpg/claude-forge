// Headless single-shot SDK runner for orchestration subtasks
// (docs/SQUAD_ORCHESTRATION.md §6 — the live model-call adapter the conductor /
// topology engine inject behind `deps.run`). Unlike runStreaming this does NOT
// stream to a renderer: it runs one prompt to completion and returns the final
// assistant text + cost, which becomes the subtask Artifact.
//
// SECURITY (CLAUDE.md): a squad subtask is READ-ONLY by default. canUseTool here
// allows only non-mutating tools and denies Write/Edit/Bash/Task/AskUserQuestion,
// so orchestration can never modify the workspace or block on a human.

import { buildEnv, ensureWorkspace, SETTING_SOURCES } from './env'

/** Tools a read-only subtask may use; everything else is denied. */
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'TodoWrite'])

export interface SubtaskRunResult {
  output: string
  costUsd: number
  model: string
}

export interface SubtaskRunOptions {
  instruction: string
  /** Model alias the SDK accepts: 'haiku' | 'sonnet' | 'opus' (or a full id). */
  model: string
  /** Prior subtasks' outputs (blackboard) prepended as read-only context. */
  context?: string
  /** Extra system-prompt guidance for this subtask. */
  systemAppend?: string
  /** Loop cap (token/runaway guard). Default 6. */
  maxTurns?: number
}

/**
 * Run one subtask to completion and return its text + cost. Read-only: a denied
 * tool returns a deny result, so the model falls back to answering in text.
 */
export async function runSubtaskQuery(opts: SubtaskRunOptions): Promise<SubtaskRunResult> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const env = await buildEnv()
  const cwd = await ensureWorkspace()

  const prompt = opts.context
    ? `Context from earlier subtasks (read-only):\n${opts.context}\n\n---\nYour task: ${opts.instruction}`
    : opts.instruction

  const options: Record<string, unknown> = {
    env,
    cwd,
    model: opts.model,
    maxTurns: opts.maxTurns && opts.maxTurns > 0 ? opts.maxTurns : 6,
    settingSources: [...SETTING_SOURCES],
    // 'default' routes tool uses through canUseTool (our read-only gate) instead
    // of auto-allowing them — never bypassPermissions (that would permit writes).
    permissionMode: 'default',
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append:
        'You are a subagent executing ONE scoped subtask within an orchestrated plan. ' +
        'Answer directly and concisely in plain text — this text is your deliverable. ' +
        'You are read-only: do not attempt to modify files or run commands. ' +
        (opts.systemAppend ?? '')
    }
  }

  options.canUseTool = async (
    toolName: string,
    input: Record<string, unknown>
  ): Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }> =>
    READ_ONLY_TOOLS.has(toolName)
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'Squad subtask is read-only' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = query({ prompt, options } as any)
  let text = ''
  let costUsd = 0
  let model = opts.model
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const msg of q as AsyncIterable<any>) {
    if (msg.type === 'system' && msg.subtype === 'init' && msg.model) {
      model = msg.model
    } else if (msg.type === 'assistant') {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        for (const b of content) if (b?.type === 'text' && b.text) text += b.text
      }
    } else if (msg.type === 'result') {
      costUsd = msg.total_cost_usd ?? 0
    }
  }
  return { output: text.trim(), costUsd, model }
}
