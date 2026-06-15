// Pure observation → memory-entry transform + privacy filter (agentmemory's
// "PostToolUse → dedup → privacy filter → structured fact" stage, minus the LLM
// compression which is off by default there too). NO electron/SDK imports →
// unit-tested headlessly.

import type { MemoryEntry, MemoryKind, Observation } from './types'

/** FNV-1a 32-bit hash → hex. Deterministic dedupe key, no crypto import needed. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// Secret shapes to strip BEFORE anything is stored. agentmemory's privacy filter
// is the non-negotiable gate: a memory file the model can later read must never
// hold a live credential. Conservative — over-redaction is fine here.
const SECRET_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /sk-ant-[A-Za-z0-9_-]{8,}/g, label: '[anthropic-key]' },
  { re: /sk-[A-Za-z0-9]{16,}/g, label: '[api-key]' },
  { re: /gh[pousr]_[A-Za-z0-9]{16,}/g, label: '[gh-token]' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, label: '[slack-token]' },
  { re: /AKIA[0-9A-Z]{16}/g, label: '[aws-key]' },
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, label: '[jwt]' },
  // KEY=secret / TOKEN: "secret" style assignments (value redacted, name kept).
  { re: /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*)\s*[:=]\s*["']?[^\s"']{6,}/gi, label: '$1=[redacted]' }
]

export interface RedactResult {
  text: string
  hadSecret: boolean
}

/** Strip secrets and explicit <private>…</private> spans. */
export function redactSecrets(input: string): RedactResult {
  let text = input
  let hadSecret = false
  // Drop anything the user explicitly marked private.
  text = text.replace(/<private>[\s\S]*?<\/private>/gi, () => {
    hadSecret = true
    return '[private]'
  })
  for (const { re, label } of SECRET_PATTERNS) {
    text = text.replace(re, (...args) => {
      hadSecret = true
      // Support the `$1=[redacted]` capture form for KEY=value assignments.
      return label.includes('$1') ? label.replace('$1', String(args[1] ?? '')) : label
    })
  }
  return { text, hadSecret }
}

function ext(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path)
  return m ? m[1].toLowerCase() : ''
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * Turn a tool observation into a durable memory candidate, or null when it's
 * low-value noise (reads/searches) or empties after redaction. Only the actions
 * that change or reveal lasting project facts are kept: file edits (semantic)
 * and shell commands (procedural). Reads/greps/globs are deliberately dropped —
 * capturing them is the noise that sinks naive memory systems.
 */
export function observationToEntry(
  obs: Observation
): Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccess' | 'accessCount'> | null {
  let kind: MemoryKind
  let text: string
  const tags: string[] = []

  const tool = obs.tool
  const input = obs.input ?? {}

  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    const file = str(input.file_path) || str(input.path) || str(input.notebook_path)
    if (!file) return null
    kind = 'semantic'
    const verb = tool === 'Write' ? 'Wrote' : 'Edited'
    text = `${verb} ${file}`
    tags.push('edit')
    const e = ext(file)
    if (e) tags.push(e)
  } else if (tool === 'Bash') {
    const cmd = str(input.command)
    if (!cmd.trim()) return null
    kind = 'procedural'
    text = `Ran: ${cmd.split('\n')[0].slice(0, 200)}`
    tags.push('bash')
  } else {
    return null // Read/Grep/Glob/Task/… are not durable facts.
  }

  const { text: clean } = redactSecrets(text)
  if (!clean.trim()) return null

  return {
    kind,
    text: clean,
    tags,
    source: `tool:${tool}`,
    sessionId: obs.sessionId,
    workspaceId: obs.workspaceId,
    hash: fnv1a(`${kind}|${clean.toLowerCase()}`)
  }
}
