// Pure-ish runner helpers (docs/MAINTAINABILITY.md Phase 4). Extracted verbatim
// from the former src/main/agent.ts.

import type { Attachment } from './types'

/**
 * An async generator that never yields — used to keep a query stream open for
 * control-method probing (getCapabilities) without submitting any prompt.
 */
// Intentionally never yields — it blocks forever to keep the query stream open.
// eslint-disable-next-line require-yield
export async function* idlePrompt(): AsyncGenerator<never> {
  await new Promise<void>(() => {})
}

export function resultErrorMessage(subtype: string): string {
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

export function toolContentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === 'string' ? c : c?.type === 'text' ? c.text : JSON.stringify(c)))
      .join('\n')
  }
  return content == null ? '' : JSON.stringify(content)
}

export async function* singlePrompt(prompt: string, attachments?: Attachment[]): AsyncGenerator<any> {
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
