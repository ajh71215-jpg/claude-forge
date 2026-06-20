// Subscription usage probe (docs/MAINTAINABILITY.md Phase 4). Extracted verbatim
// from the former src/main/agent.ts.

import { buildEnv } from './env'
import type { UsageEntry, UsageInfo } from './types'

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
      // The /usage output can surface as assistant text OR as the final result
      // message depending on SDK/CLI version — capture both so a parse isn't
      // randomly empty just because the text landed in a different envelope.
      if (msg.type === 'assistant') {
        for (const b of msg.message?.content ?? []) if (b.type === 'text') text += b.text + '\n'
      } else if (msg.type === 'result' && typeof msg.result === 'string') {
        text += msg.result + '\n'
      }
    }
  } catch {
    /* offline / error */
  }
  const entries: UsageEntry[] = []
  // Tolerant parse: case-insensitive, and the separator before "resets" may be a
  // middot, hyphen, en/em dash, or bullet across CLI versions.
  const re = /Current\s+([^:]+):\s*(\d+)%\s*used\s*[·•\-–—]\s*resets\s*([^\n]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    entries.push({ label: m[1].trim(), percent: Number(m[2]), resets: m[3].trim() })
  }
  return { entries, raw: text.trim() }
}
