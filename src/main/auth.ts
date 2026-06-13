import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/**
 * Authentication for the SDK subprocess.
 *
 * Claude Code / the Agent SDK pick credentials in this precedence order:
 *   1. Cloud provider (CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY)
 *   2. ANTHROPIC_AUTH_TOKEN
 *   3. ANTHROPIC_API_KEY            <- X-Api-Key
 *   4. apiKeyHelper
 *   5. CLAUDE_CODE_OAUTH_TOKEN      <- long-lived token from `claude setup-token`
 *   6. Subscription OAuth login     <- ~/.claude/.credentials.json (from `/login`)
 *
 * Forge supports three modes:
 *   - 'subscription' : reuse the existing Claude Code login (#6). No secret is
 *                      stored. We must STRIP ANTHROPIC_API_KEY / OAUTH token from
 *                      the child env, since #3/#5 would otherwise shadow #6.
 *   - 'oauth-token'  : a CLAUDE_CODE_OAUTH_TOKEN (#5), stored encrypted. Portable
 *                      across machines (no prior /login needed).
 *   - 'api-key'      : an ANTHROPIC_API_KEY (#3), stored encrypted.
 *
 * The plaintext secret never leaves the main process.
 */

export type AuthMode = 'subscription' | 'oauth-token' | 'api-key'

interface StoredAuth {
  mode: AuthMode
}

export interface AuthStatus {
  mode: AuthMode | null
  /** Whether a Claude Code subscription login already exists on this machine. */
  hasExistingLogin: boolean
}

function configPath(): string {
  return join(app.getPath('userData'), 'auth.json')
}
function secretPath(): string {
  return join(app.getPath('userData'), 'secret.bin')
}

/** Location of the Claude Code subscription login, honoring CLAUDE_CONFIG_DIR. */
export function claudeCredentialsPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(dir, '.credentials.json')
}

export async function hasExistingClaudeLogin(): Promise<boolean> {
  try {
    await fs.access(claudeCredentialsPath())
    return true
  } catch {
    return false
  }
}

async function getMode(): Promise<AuthMode | null> {
  try {
    const raw = await fs.readFile(configPath(), 'utf-8')
    return (JSON.parse(raw) as StoredAuth).mode
  } catch {
    return null
  }
}

async function writeMode(mode: AuthMode): Promise<void> {
  await fs.writeFile(configPath(), JSON.stringify({ mode } satisfies StoredAuth, null, 2))
}

async function writeSecret(value: string): Promise<void> {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Empty credential')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption (safeStorage) is not available on this machine')
  }
  await fs.writeFile(secretPath(), safeStorage.encryptString(trimmed))
}

/** Main-process only. Not exposed over IPC. */
async function readSecret(): Promise<string | null> {
  try {
    return safeStorage.decryptString(await fs.readFile(secretPath()))
  } catch {
    return null
  }
}

async function removeSecret(): Promise<void> {
  try {
    await fs.unlink(secretPath())
  } catch {
    /* already gone */
  }
}

export async function getStatus(): Promise<AuthStatus> {
  return { mode: await getMode(), hasExistingLogin: await hasExistingClaudeLogin() }
}

export async function setSubscription(): Promise<void> {
  await removeSecret() // rely on the existing ~/.claude login; nothing to store
  await writeMode('subscription')
}

export async function setOAuthToken(token: string): Promise<void> {
  await writeSecret(token)
  await writeMode('oauth-token')
}

export async function setApiKey(key: string): Promise<void> {
  await writeSecret(key)
  await writeMode('api-key')
}

export async function clearAuth(): Promise<void> {
  await removeSecret()
  try {
    await fs.unlink(configPath())
  } catch {
    /* already gone */
  }
}

/**
 * Env overrides for spawning the SDK subprocess (used in Step 2).
 * Keys mapped to `undefined` MUST be deleted from the child env by the caller,
 * so that a stray ANTHROPIC_API_KEY can't shadow subscription auth.
 */
export async function resolveAuthEnv(): Promise<Record<string, string | undefined>> {
  const mode = await getMode()
  const env: Record<string, string | undefined> = {}

  if (mode === 'api-key') {
    const k = await readSecret()
    if (k) env.ANTHROPIC_API_KEY = k
    // A stray ANTHROPIC_AUTH_TOKEN (#2) in the inherited env outranks the API
    // key (#3), so strip it; drop the OAuth token too for good measure.
    env.ANTHROPIC_AUTH_TOKEN = undefined
    env.CLAUDE_CODE_OAUTH_TOKEN = undefined
  } else if (mode === 'oauth-token') {
    const t = await readSecret()
    if (t) env.CLAUDE_CODE_OAUTH_TOKEN = t
    env.ANTHROPIC_API_KEY = undefined // #3 don't let an API key outrank the token
    env.ANTHROPIC_AUTH_TOKEN = undefined // #2 outranks the #5 OAuth token — strip it
  } else if (mode === 'subscription') {
    // Use the existing /login credentials. Strip anything that outranks #6.
    env.ANTHROPIC_API_KEY = undefined
    env.ANTHROPIC_AUTH_TOKEN = undefined
    env.CLAUDE_CODE_OAUTH_TOKEN = undefined
  }
  return env
}
