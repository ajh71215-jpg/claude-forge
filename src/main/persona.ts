import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

/**
 * Agent behavior customization ("persona").
 *
 * A single, global custom instruction set that is applied to every run. This is
 * a legitimate, first-class SDK feature: the instructions are layered onto the
 * model via the `systemPrompt` option. The model's own safety training is
 * unaffected — this only steers persona, tone and workflow.
 *
 * Stored as plaintext JSON in userData (it is not a secret).
 */

export type PersonaMode = 'append' | 'replace'

export interface Persona {
  /** When off, runs use the default Claude Code behavior with no extra instructions. */
  enabled: boolean
  /**
   * 'append'  — keep the default agent behavior (tools, etc.) and add your text. Safe default.
   * 'replace' — swap the entire system prompt for your text. Advanced; can break tool guidance.
   */
  mode: PersonaMode
  /** The custom instructions. */
  text: string
}

const DEFAULT_PERSONA: Persona = { enabled: false, mode: 'append', text: '' }

function personaPath(): string {
  return join(app.getPath('userData'), 'persona.json')
}

/** Normalize arbitrary input into a well-formed Persona. */
function normalize(p: Partial<Persona> | null | undefined): Persona {
  return {
    enabled: Boolean(p?.enabled),
    mode: p?.mode === 'replace' ? 'replace' : 'append',
    text: typeof p?.text === 'string' ? p.text : ''
  }
}

export async function getPersona(): Promise<Persona> {
  try {
    const raw = await fs.readFile(personaPath(), 'utf-8')
    return normalize(JSON.parse(raw) as Partial<Persona>)
  } catch {
    return { ...DEFAULT_PERSONA }
  }
}

export async function setPersona(persona: Persona): Promise<Persona> {
  const clean = normalize(persona)
  await fs.writeFile(personaPath(), JSON.stringify(clean, null, 2))
  return clean
}

/** SDK `systemPrompt` option for this persona, or undefined to keep SDK defaults. */
export function personaToSystemPrompt(
  p: Persona
): string | { type: 'preset'; preset: 'claude_code'; append?: string } | undefined {
  if (!p.enabled || !p.text.trim()) return undefined
  if (p.mode === 'replace') return p.text
  return { type: 'preset', preset: 'claude_code', append: p.text }
}
