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

/** Fence info-string for a file name, so inlined code renders with the right
 * highlighting. Falls back to the bare extension (still useful) or ''. */
function fenceLang(name: string): string {
  const ext = name.toLowerCase().includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  const map: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
    ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript',
    py: 'python', rb: 'ruby', rs: 'rust', kt: 'kotlin', cs: 'csharp',
    sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', yml: 'yaml',
    md: 'markdown', html: 'html', htm: 'html', svg: 'xml'
  }
  return map[ext] ?? ext
}

export async function* singlePrompt(prompt: string, attachments?: Attachment[]): AsyncGenerator<any> {
  const atts = attachments ?? []
  const textFiles = atts.filter((a) => a.kind === 'text' && a.text != null)
  const imageFiles = atts.filter((a) => a.kind !== 'text')

  // Inline text/code files into the prompt as labelled fenced blocks.
  let promptText = prompt
  if (textFiles.length) {
    const blocks = textFiles
      .map((a) => `Attached file: ${a.name ?? 'file'}\n\`\`\`${fenceLang(a.name ?? '')}\n${a.text}\n\`\`\``)
      .join('\n\n')
    promptText = promptText ? `${promptText}\n\n${blocks}` : blocks
  }

  const content =
    imageFiles.length > 0
      ? [
          { type: 'text', text: promptText },
          ...imageFiles.map((a) => ({
            type: 'image',
            source: { type: 'base64', media_type: a.mediaType, data: a.base64 }
          }))
        ]
      : promptText
  yield {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null
  }
}
