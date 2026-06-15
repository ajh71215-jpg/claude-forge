// Free / cheaper non-Anthropic provider registry (docs/GOOSE_INTEGRATION.md).
// Forge drives these through `goose` (Block's agent), so a provider entry maps to
// goose's per-process env (GOOSE_PROVIDER / GOOSE_MODEL + the provider key env).
//
// Mirrors mcp.ts exactly: secret-bearing, so entries persist to a Forge-private
// `forge-providers.json` at the workspace root — OUTSIDE `.claude/` so the model
// can never read the keys. Pure-ish (only fs via projectSettings) → no SDK import.

import { readForgeConfig, writeForgeConfig } from './projectSettings'

/** A goose-routable provider. `gooseProvider` is the GOOSE_PROVIDER value. */
export interface ProviderEntry {
  /** Stable Forge id / display handle (e.g. 'openrouter-free'). */
  id: string
  /** GOOSE_PROVIDER value: 'openrouter' | 'google' | 'groq' | 'ollama' | … */
  gooseProvider: string
  /** GOOSE_MODEL value, e.g. 'qwen/qwen3-coder:free' or 'gemini-2.0-flash'. */
  defaultModel: string
  /** Env var the key is injected as, e.g. 'OPENROUTER_API_KEY'. Omit for ollama. */
  apiKeyEnv?: string
  /** Secret — stays in forge-providers.json, never surfaced to the model. */
  apiKey?: string
  /** Ollama base URL (OLLAMA_HOST); only for the local provider. */
  ollamaHost?: string
  /** Routing hint: prefer this entry for trivial/easy delegated subtasks. */
  free: boolean
  /** Disabled entries are ignored by the delegate tool. */
  enabled: boolean
}

export interface ProviderSaveInput extends ProviderEntry {
  /** Previous id when editing+renaming. */
  originalId?: string
}

export type ProviderSaveResult =
  | { ok: true; providers: ProviderEntry[] }
  | { ok: false; error: string }

const FILE = 'forge-providers.json'
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** Providers whose secret is an API key env var (everything except local ollama). */
const KEY_ENV: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  google: 'GOOGLE_API_KEY',
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY'
}

async function readAll(): Promise<ProviderEntry[]> {
  const cfg = await readForgeConfig<{ providers?: ProviderEntry[] }>(FILE, { providers: [] })
  return Array.isArray(cfg.providers) ? cfg.providers : []
}
async function writeAll(providers: ProviderEntry[]): Promise<void> {
  await writeForgeConfig(FILE, { providers })
}

export async function listProviders(): Promise<ProviderEntry[]> {
  return (await readAll()).sort((a, b) => a.id.localeCompare(b.id))
}

/** Enabled entries only, for the delegate tool / provider picker. */
export async function enabledProviders(): Promise<ProviderEntry[]> {
  return (await readAll()).filter((p) => p.enabled)
}

/** Normalize an inbound entry, trimming + defaulting the key env per provider. */
function clean(input: ProviderEntry): ProviderEntry {
  const gooseProvider = (input.gooseProvider ?? '').trim().toLowerCase()
  const e: ProviderEntry = {
    id: input.id.trim(),
    gooseProvider,
    defaultModel: (input.defaultModel ?? '').trim(),
    free: input.free !== false,
    enabled: input.enabled !== false
  }
  if (gooseProvider === 'ollama') {
    e.ollamaHost = (input.ollamaHost ?? '').trim() || 'http://localhost:11434'
  } else {
    e.apiKeyEnv = (input.apiKeyEnv ?? '').trim() || KEY_ENV[gooseProvider] || ''
    const key = (input.apiKey ?? '').trim()
    if (key) e.apiKey = key
  }
  return e
}

export async function saveProvider(input: ProviderSaveInput): Promise<ProviderSaveResult> {
  const id = (input.id || '').trim()
  if (!ID_RE.test(id)) {
    return { ok: false, error: 'Id must be 1–64 chars: letters, digits, _ or -.' }
  }
  const gooseProvider = (input.gooseProvider ?? '').trim().toLowerCase()
  if (!gooseProvider) return { ok: false, error: 'Pick a goose provider.' }
  if (!(input.defaultModel ?? '').trim()) return { ok: false, error: 'A default model is required.' }
  if (gooseProvider !== 'ollama' && !(input.apiKey ?? '').trim() && !input.originalId) {
    return { ok: false, error: `${gooseProvider} needs an API key.` }
  }

  const orig = input.originalId?.trim()
  const providers = await readAll()
  if (providers.some((p) => p.id === id && p.id !== orig)) {
    return { ok: false, error: `A provider with id "${id}" already exists.` }
  }
  const entry = clean(input)
  const idx = orig ? providers.findIndex((p) => p.id === orig) : -1
  // Preserve an existing key when editing without re-entering it.
  if (idx >= 0 && !entry.apiKey && providers[idx].apiKey) entry.apiKey = providers[idx].apiKey
  if (idx >= 0) providers[idx] = entry
  else providers.push(entry)
  await writeAll(providers)
  return { ok: true, providers: await listProviders() }
}

export async function deleteProvider(id: string): Promise<ProviderEntry[]> {
  const providers = (await readAll()).filter((p) => p.id !== id)
  await writeAll(providers)
  return listProviders()
}

/**
 * The goose subprocess env for a provider: GOOSE_PROVIDER/GOOSE_MODEL plus the
 * key env (or OLLAMA_HOST for local). The caller layers GOOSE_MODE + XDG dirs on.
 */
export function toGooseEnv(entry: ProviderEntry): Record<string, string> {
  const env: Record<string, string> = {
    GOOSE_PROVIDER: entry.gooseProvider,
    GOOSE_MODEL: entry.defaultModel
  }
  if (entry.gooseProvider === 'ollama') {
    env.OLLAMA_HOST = entry.ollamaHost || 'http://localhost:11434'
  } else if (entry.apiKeyEnv && entry.apiKey) {
    env[entry.apiKeyEnv] = entry.apiKey
  }
  return env
}
