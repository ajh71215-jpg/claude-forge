import { promises as fs } from 'fs'

/**
 * Minimal YAML-frontmatter helpers shared by the file-backed extension editors
 * (skills, commands, agents).
 *
 * We only deal with flat `key: value` scalars — enough for the SKILL.md /
 * command / agent frontmatter the SDK reads. Quoting is JSON-style, which is a
 * valid YAML double-quoted scalar for our inputs.
 */

/** Slug used for `.claude/<thing>/<name>` directory/file names. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
export function isValidSlug(name: string): boolean {
  return SLUG_RE.test(name)
}

export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/.exec(raw)
  if (!m) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let val = line.slice(idx + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (key) meta[key] = val
  }
  return { meta, body: m[2] }
}

function quoteIfNeeded(v: string): string {
  return /[:#"'\n]|^\s|\s$/.test(v) ? JSON.stringify(v) : v
}

/** Build a frontmatter doc. Empty-valued fields are dropped. */
export function serializeFrontmatter(fields: Array<[string, string]>, body: string): string {
  const lines = fields
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${quoteIfNeeded(v)}`)
  const front = `---\n${lines.join('\n')}\n---\n`
  const b = body.trim()
  return b ? `${front}\n${b}\n` : front
}

/** Async file-existence check (shared by commands, agents, skills). */
export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
