// Build the goose subprocess env (docs/GOOSE_INTEGRATION.md §4).
//
// Mirrors Octopal's `env_clear()` + curated map: we DON'T inherit the parent env
// wholesale (the main run's ANTHROPIC_* / subscription state must not leak into a
// free-provider goose run). We pass only PATH (goose's Developer extension needs
// to find node/ripgrep), the provider env (GOOSE_PROVIDER/MODEL + key), GOOSE_MODE,
// and XDG dirs pinned under userData so goose never touches the user's own
// ~/.config/goose.

import { app } from 'electron'
import { join } from 'path'
import { type ProviderEntry, toGooseEnv } from '../providers'

export type GooseMode = 'auto' | 'approve' | 'smart_approve' | 'chat'

/** Forge-private goose home so a run can't read/write the user's goose config. */
function gooseHome(): string {
  return join(app.getPath('userData'), 'goose')
}

export function buildGooseEnv(entry: ProviderEntry, mode: GooseMode): Record<string, string> {
  const home = gooseHome()
  const env: Record<string, string> = {
    PATH: process.env.PATH || '',
    GOOSE_MODE: mode,
    // Runaway guard: goose's default max-turns is 1000. A delegated subtask should
    // be small — cap turns so a confused free model can't loop indefinitely.
    // Best-effort (honored if this goose build reads it); override via env.
    GOOSE_MAX_TURNS: process.env.FORGE_GOOSE_MAX_TURNS || '30',
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'),
    XDG_STATE_HOME: join(home, 'state'),
    HOME: home,
    ...toGooseEnv(entry)
  }
  // SystemRoot/TEMP are needed for spawning on Windows.
  if (process.platform === 'win32') {
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot
    if (process.env.TEMP) env.TEMP = process.env.TEMP
    if (process.env.USERPROFILE) env.USERPROFILE = process.env.USERPROFILE
  }
  return env
}
