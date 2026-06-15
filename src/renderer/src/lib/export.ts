// Conversation export (Markdown / JSON). Pure serializers — no DOM, no IPC — so
// they're trivially testable and reusable. The chat view feeds them the restored
// history (TranscriptItem[]) + the live turns (Turn[]); they produce a single
// portable document of the whole conversation.
import type { Block, TranscriptItem, Turn } from '../types'
import { toolArg, toolArgObj } from './format'

export interface ExportConversation {
  history: TranscriptItem[]
  turns: Turn[]
}

function fence(s: string): string[] {
  const body = s.length > 4000 ? s.slice(0, 4000) + '\n… (truncated)' : s
  return ['```', body, '```']
}

function blockMd(b: Block): string[] {
  if (b.kind === 'text') return b.text ? [b.text, ''] : []
  if (b.kind === 'thinking')
    return b.text ? ['> _thinking_', ...b.text.split('\n').map((l) => '> ' + l), ''] : []
  const arg = toolArg(b.inputRaw)
  const head = `- **${b.name}**${arg ? ' `' + arg + '`' : ''} → ${b.status.toUpperCase()}`
  return b.result ? [head, '', ...fence(b.result), ''] : [head, '']
}

function itemMd(it: TranscriptItem): string[] {
  if (it.kind === 'user') return ['## 🧑 You', '', it.text, '']
  if (it.kind === 'text') return ['### ⚒ Assistant', '', it.text, '']
  if (it.kind === 'thinking')
    return it.text ? ['> _thinking_', ...it.text.split('\n').map((l) => '> ' + l), ''] : []
  const arg = toolArgObj(it.input)
  const head = `- **${it.name}**${arg ? ' `' + arg + '`' : ''} → ${it.status.toUpperCase()}`
  return it.result ? [head, '', ...fence(it.result), ''] : [head, '']
}

/** Render the whole conversation as a Markdown document. */
export function conversationToMarkdown(c: ExportConversation): string {
  const lines: string[] = ['# Claude Forge — conversation', '', `_Exported ${new Date().toLocaleString()}_`, '']
  for (const it of c.history) lines.push(...itemMd(it))
  if (c.history.length && c.turns.length) lines.push('---', '')
  for (const t of c.turns) {
    lines.push('## 🧑 You', '', t.prompt, '', '### ⚒ Assistant', '')
    for (const b of t.blocks) lines.push(...blockMd(b))
    if (t.meta?.error) lines.push(`> ⚠ ${t.meta.error}`, '')
    if (t.meta && typeof t.meta.costUsd === 'number')
      lines.push(`_$${t.meta.costUsd.toFixed(4)}${t.meta.durationMs ? ` · ${(t.meta.durationMs / 1000).toFixed(1)}s` : ''}_`, '')
    lines.push('')
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** Render the whole conversation as a structured JSON document. */
export function conversationToJson(c: ExportConversation): string {
  return JSON.stringify(
    {
      app: 'Claude Forge',
      exportedAt: new Date().toISOString(),
      history: c.history,
      turns: c.turns.map((t) => ({ prompt: t.prompt, blocks: t.blocks, meta: t.meta }))
    },
    null,
    2
  )
}
