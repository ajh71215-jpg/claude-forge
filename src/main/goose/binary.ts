// Resolve the bundled `goose` binary (docs/GOOSE_INTEGRATION.md §4).
// Shipped like claude.exe: a real on-disk file under resources (asar:false), one
// per platform/arch. Dev falls back to `goose` on PATH behind FORGE_GOOSE_DEV=1.

import { promises as fs } from 'fs'
import { join } from 'path'

/** `<platform>-<arch>` dir name matching scripts/ensure-goose.mjs layout. */
function platformDir(): string {
  return `${process.platform}-${process.arch}`
}
function exeName(): string {
  return process.platform === 'win32' ? 'goose.exe' : 'goose'
}

/**
 * Path to the bundled goose binary, or 'goose' (PATH) in dev. Does not verify
 * existence — call resolveGooseBinary() for that.
 */
export function gooseBinaryPath(): string {
  if (process.env.FORGE_GOOSE_DEV === '1') return process.env.FORGE_GOOSE_BIN || 'goose'
  // process.resourcesPath exists in a packaged Electron app; fall back to cwd in dev.
  const base = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || process.cwd()
  return join(base, 'goose', platformDir(), exeName())
}

/** Resolve + verify the goose binary is present, with a clear error otherwise. */
export async function resolveGooseBinary(): Promise<string> {
  const p = gooseBinaryPath()
  if (p === 'goose' || (process.env.FORGE_GOOSE_BIN && p === process.env.FORGE_GOOSE_BIN)) return p
  try {
    await fs.access(p)
    return p
  } catch {
    throw new Error(
      `goose binary not found at ${p}. Run "node scripts/ensure-goose.mjs" (build) or set FORGE_GOOSE_DEV=1 to use a goose on PATH.`
    )
  }
}
