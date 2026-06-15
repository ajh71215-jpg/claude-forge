import { promises as fs } from 'fs'
import { join } from 'path'
import { claudeDir } from './projectSettings'
import { isValidSlug, parseFrontmatter, serializeFrontmatter, fileExists } from './frontmatter'

/**
 * Reusable subagents (roadmap #5). Each is a `.claude/agents/<name>.md` with
 * frontmatter (`name`, `description`, optional `tools`, `model`) and a Markdown
 * body = the agent's system prompt. The SDK discovers these (settingSources
 * 'project') and exposes them via supportedAgents(); the model delegates to them
 * through the Task tool. Forge just edits the files.
 */

export interface AgentMeta {
  name: string
  description: string
  tools?: string
  model?: string
  path: string
}
export interface AgentDetail extends AgentMeta {
  body: string
}
export interface AgentInput {
  name: string
  description: string
  tools?: string
  model?: string
  body: string
  originalName?: string
}
export type AgentWriteResult =
  | { ok: true; agents: AgentMeta[] }
  | { ok: false; error: string }

function agentsRoot(): string {
  return join(claudeDir(), 'agents')
}
function fileFor(name: string): string {
  return join(agentsRoot(), `${name}.md`)
}

export async function listAgents(): Promise<AgentMeta[]> {
  const root = agentsRoot()
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out: AgentMeta[] = []
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
      tools: meta.tools || undefined,
      model: meta.model || undefined,
      path: join(root, e.name)
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export async function readAgent(name: string): Promise<AgentDetail | null> {
  if (!isValidSlug(name)) return null
  try {
    const raw = await fs.readFile(fileFor(name), 'utf8')
    const { meta, body } = parseFrontmatter(raw)
    return {
      name,
      description: meta.description ?? '',
      tools: meta.tools || undefined,
      model: meta.model || undefined,
      body: body.replace(/^\r?\n+/, ''),
      path: fileFor(name)
    }
  } catch {
    return null
  }
}

export async function writeAgent(input: AgentInput): Promise<AgentWriteResult> {
  const name = (input.name || '').trim()
  if (!isValidSlug(name)) {
    return { ok: false, error: 'Name must be lowercase letters, digits and hyphens (e.g. test-writer).' }
  }
  const root = agentsRoot()
  const orig = input.originalName?.trim()
  if (orig && !isValidSlug(orig)) {
    return { ok: false, error: 'Invalid original name.' }
  }
  try {
    await fs.mkdir(root, { recursive: true })
    if (orig && orig !== name) {
      if (await fileExists(fileFor(name))) {
        return { ok: false, error: `An agent "${name}" already exists.` }
      }
      // The new file is written with fresh content below, so a rename only needs
      // to drop the original. force: tolerate a missing original instead of a
      // failed rename silently orphaning it under the old name.
      await fs.rm(fileFor(orig), { force: true })
    } else if (!orig) {
      if (await fileExists(fileFor(name))) {
        return { ok: false, error: `An agent "${name}" already exists.` }
      }
    }
    const content = serializeFrontmatter(
      [
        ['name', name],
        ['description', input.description ?? ''],
        ['tools', (input.tools ?? '').trim()],
        ['model', (input.model ?? '').trim()]
      ],
      input.body ?? ''
    )
    await fs.writeFile(fileFor(name), content, 'utf8')
    return { ok: true, agents: await listAgents() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function deleteAgent(name: string): Promise<AgentMeta[]> {
  if (isValidSlug(name)) {
    await fs.rm(fileFor(name), { force: true }).catch(() => {})
  }
  return listAgents()
}

