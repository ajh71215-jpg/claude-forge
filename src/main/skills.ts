import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

/**
 * Skills console (roadmap feature #1).
 *
 * Source of truth is the filesystem `.claude/skills/<name>/SKILL.md` under
 * Forge's persistent workspace — the same dir agent.ts's `workspaceDir()`
 * returns and runs anchor their cwd to. Each skill is a directory whose
 * SKILL.md has YAML frontmatter (`name`, `description`) plus a Markdown body.
 *
 * Enabled/disabled state is a Forge concept layered on top: it maps to the SDK
 * `skills` option (`'all'` | string[] of enabled names). We persist the
 * *disabled* set in `forge-skills.json` OUTSIDE `.claude/` so the SDK never
 * reads it as project config.
 */

export interface SkillMeta {
  /** Directory name — the canonical id used by the SDK `skills` filter. */
  name: string
  /** `name:` from frontmatter (should mirror the directory name). */
  frontName?: string
  description: string
  enabled: boolean
  /** Absolute path to SKILL.md (for display / debugging). */
  path: string
}

export interface SkillDetail extends SkillMeta {
  /** Markdown body with the frontmatter block stripped. */
  body: string
}

export interface SkillInput {
  name: string
  description: string
  body: string
  /** When editing+renaming, the previous directory name to move from. */
  originalName?: string
}

export type SkillWriteResult =
  | { ok: true; skills: SkillMeta[] }
  | { ok: false; error: string }

// Mirrors agent.ts workspaceDir(); kept local to avoid an import cycle
// (agent.ts imports resolveSkillsOption from here).
function workspaceRoot(): string {
  return join(app.getPath('userData'), 'workspace')
}
function skillsRoot(): string {
  return join(workspaceRoot(), '.claude', 'skills')
}
function configPath(): string {
  return join(workspaceRoot(), 'forge-skills.json')
}

/** Skill/dir names: lowercase, digits and hyphens — matches the SDK skill id. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
export function isValidSkillName(name: string): boolean {
  return NAME_RE.test(name)
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/.exec(raw)
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

/** Build SKILL.md content. Quote the description when YAML would misparse it. */
function serialize(name: string, description: string, body: string): string {
  const desc = description.trim()
  // JSON.stringify yields a valid YAML double-quoted scalar for our cases.
  const safeDesc = /[:#"'\n]|^\s|\s$/.test(desc) ? JSON.stringify(desc) : desc
  const front = `---\nname: ${name}\ndescription: ${safeDesc}\n---\n`
  const b = body.trim()
  return b ? `${front}\n${b}\n` : front
}

async function readDisabled(): Promise<string[]> {
  try {
    const raw = await fs.readFile(configPath(), 'utf8')
    const o = JSON.parse(raw)
    return Array.isArray(o?.disabled)
      ? (o.disabled as unknown[]).filter((x): x is string => typeof x === 'string')
      : []
  } catch {
    return []
  }
}

async function writeDisabled(disabled: string[]): Promise<void> {
  await fs.mkdir(workspaceRoot(), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify({ disabled }, null, 2), 'utf8')
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

/** All authored skills, newest config wins for enabled state, sorted by name. */
export async function listSkills(): Promise<SkillMeta[]> {
  const root = skillsRoot()
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const disabled = await readDisabled()
  const out: SkillMeta[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const file = join(root, e.name, 'SKILL.md')
    let raw: string
    try {
      raw = await fs.readFile(file, 'utf8')
    } catch {
      continue // a dir without SKILL.md isn't a skill
    }
    const { meta } = parseFrontmatter(raw)
    out.push({
      name: e.name,
      frontName: meta.name,
      description: meta.description ?? '',
      enabled: !disabled.includes(e.name),
      path: file
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export async function readSkill(name: string): Promise<SkillDetail | null> {
  if (!isValidSkillName(name)) return null
  const file = join(skillsRoot(), name, 'SKILL.md')
  try {
    const raw = await fs.readFile(file, 'utf8')
    const { meta, body } = parseFrontmatter(raw)
    const disabled = await readDisabled()
    return {
      name,
      frontName: meta.name,
      description: meta.description ?? '',
      body: body.replace(/^\r?\n+/, ''),
      enabled: !disabled.includes(name),
      path: file
    }
  } catch {
    return null
  }
}

export async function writeSkill(input: SkillInput): Promise<SkillWriteResult> {
  const name = (input.name || '').trim()
  if (!isValidSkillName(name)) {
    return {
      ok: false,
      error: 'Name must be lowercase letters, digits and hyphens (e.g. pdf-export).'
    }
  }
  const root = skillsRoot()
  const dir = join(root, name)
  const orig = input.originalName?.trim()
  try {
    await fs.mkdir(root, { recursive: true })

    if (orig && orig !== name) {
      // Rename: refuse to clobber an existing skill.
      if (await dirExists(dir)) return { ok: false, error: `A skill named "${name}" already exists.` }
      try {
        await fs.rename(join(root, orig), dir)
      } catch {
        await fs.mkdir(dir, { recursive: true })
      }
      // Carry the disabled flag across the rename.
      const disabled = new Set(await readDisabled())
      if (disabled.has(orig)) {
        disabled.delete(orig)
        disabled.add(name)
        await writeDisabled([...disabled])
      }
    } else if (!orig) {
      // Create: refuse to overwrite an existing skill.
      if (await dirExists(dir)) return { ok: false, error: `A skill named "${name}" already exists.` }
    }

    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      join(dir, 'SKILL.md'),
      serialize(name, input.description ?? '', input.body ?? ''),
      'utf8'
    )
    return { ok: true, skills: await listSkills() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function deleteSkill(name: string): Promise<SkillMeta[]> {
  if (isValidSkillName(name)) {
    await fs.rm(join(skillsRoot(), name), { recursive: true, force: true }).catch(() => {})
    const disabled = new Set(await readDisabled())
    if (disabled.delete(name)) await writeDisabled([...disabled])
  }
  return listSkills()
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<SkillMeta[]> {
  const disabled = new Set(await readDisabled())
  if (enabled) disabled.delete(name)
  else disabled.add(name)
  await writeDisabled([...disabled])
  return listSkills()
}

/**
 * The value for the SDK `skills` option:
 * - `null`  → omit it (no authored skills; preserve default behavior)
 * - `'all'` → enable every discovered skill (all authored skills enabled)
 * - `string[]` → enable only these names (some authored skill disabled)
 *
 * Note: when filtering (string[]), the SDK hides every skill not listed,
 * including bundled ones — this is the documented `skills` semantics.
 */
export async function resolveSkillsOption(): Promise<string[] | 'all' | null> {
  const skills = await listSkills()
  if (skills.length === 0) return null
  const enabled = skills.filter((s) => s.enabled).map((s) => s.name)
  return enabled.length === skills.length ? 'all' : enabled
}
