// Orchestration IPC.
//
// The live orchestration engine (conductor / topology / verifier / loop / roles)
// is kept as a tested backend LIBRARY (`npm run selftest`) but is intentionally
// NOT wired to any UI entry point. Orchestration behavior in Forge comes from
// CHAT only: magic keywords inject a directive (+ optional model tier) into a
// normal single run, and the model's own Task tool spawns native subagents — the
// conductor engine is never invoked from the app. The former dry-run / run /
// run-loop / validate / roles channels were removed together with the manual plan
// editor (see docs/SQUAD_ORCHESTRATION.md). The only channel left is the pure
// magic-keyword detector the composer uses.

import type { IpcMain } from 'electron'
import { detectKeywords, type KeywordMatch } from '../keywords'

export function register(ipc: IpcMain): void {
  // Native magic-keyword detector (OMC port): map a typed prompt to active modes
  // (ralph/ultrathink/code-review/…) so the chat composer can layer a directive
  // (+ optional tier) onto a normal run and surface the detected-mode chips.
  ipc.handle('orchestrate:detect-keywords', (_e, prompt: string): KeywordMatch[] =>
    detectKeywords(prompt)
  )
}
