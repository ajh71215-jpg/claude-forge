import { promises as fs } from 'fs'
import { join } from 'path'
import { claudeDir } from './projectSettings'
import { isValidSlug, parseFrontmatter, serializeFrontmatter, fileExists } from './frontmatter'

/**
 * Custom slash commands (roadmap #3). Each is a `.claude/commands/<name>.md`
 * with frontmatter (`description`, `argument-hint`) and a Markdown body that is
 * the prompt template — `$ARGUMENTS` is substituted by the engine. Because
 * settingSources includes 'project', the SDK auto-discovers these and they show
 * up in supportedCommands(); Forge just edits the files.
 */

export interface CommandMeta {
  name: string
  description: string
  argumentHint?: string
  path: string
}
export interface CommandDetail extends CommandMeta {
  body: string
}
export interface CommandInput {
  name: string
  description: string
  argumentHint?: string
  body: string
  originalName?: string
}
export type CommandWriteResult =
  | { ok: true; commands: CommandMeta[] }
  | { ok: false; error: string }

function commandsRoot(): string {
  return join(claudeDir(), 'commands')
}
function fileFor(name: string): string {
  return join(commandsRoot(), `${name}.md`)
}

export async function listCommands(): Promise<CommandMeta[]> {
  const root = commandsRoot()
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out: CommandMeta[] = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue
    const name = e.name.slice(0, -3)
    let raw: string
    try {
      raw = await fs.readFile(join(root, e.name), 'utf8')
    } catch {
      continue
    }
    const { meta } = parseFrontmatter(raw)
    out.push({
      name,
      description: meta.description ?? '',
      argumentHint: meta['argument-hint'] || undefined,
      path: join(root, e.name)
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export async function readCommand(name: string): Promise<CommandDetail | null> {
  if (!isValidSlug(name)) return null
  try {
    const raw = await fs.readFile(fileFor(name), 'utf8')
    const { meta, body } = parseFrontmatter(raw)
    return {
      name,
      description: meta.description ?? '',
      argumentHint: meta['argument-hint'] || undefined,
      body: body.replace(/^\r?\n+/, ''),
      path: fileFor(name)
    }
  } catch {
    return null
  }
}

export async function writeCommand(input: CommandInput): Promise<CommandWriteResult> {
  const name = (input.name || '').trim()
  if (!isValidSlug(name)) {
    return { ok: false, error: 'Name must be lowercase letters, digits and hyphens (e.g. review-pr).' }
  }
  const root = commandsRoot()
  const orig = input.originalName?.trim()
  if (orig && !isValidSlug(orig)) {
    return { ok: false, error: 'Invalid original name.' }
  }
  try {
    await fs.mkdir(root, { recursive: true })
    if (orig && orig !== name) {
      if (await fileExists(fileFor(name))) {
        return { ok: false, error: `A command "/${name}" already exists.` }
      }
      // The new file is written with fresh content below, so a rename only needs
      // to drop the original. force: tolerate a missing original instead of a
      // failed rename silently orphaning it under the old name.
      await fs.rm(fileFor(orig), { force: true })
    } else if (!orig) {
      if (await fileExists(fileFor(name))) {
        return { ok: false, error: `A command "/${name}" already exists.` }
      }
    }
    const content = serializeFrontmatter(
      [
        ['description', input.description ?? ''],
        ['argument-hint', input.argumentHint ?? '']
      ],
      input.body ?? ''
    )
    await fs.writeFile(fileFor(name), content, 'utf8')
    return { ok: true, commands: await listCommands() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function deleteCommand(name: string): Promise<CommandMeta[]> {
  if (isValidSlug(name)) {
    await fs.rm(fileFor(name), { force: true }).catch(() => {})
  }
  return listCommands()
}

