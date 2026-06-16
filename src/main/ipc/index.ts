// IPC registration barrel (docs/MAINTAINABILITY.md Phase 4). index.ts calls
// registerAll(ipcMain) once inside app.whenReady; each domain module owns its
// own ipcMain.handle channels.

import type { IpcMain } from 'electron'
import { register as registerAuth } from './auth'
import { register as registerAgent } from './agent'
import { register as registerPersona } from './persona'
import { register as registerExtend } from './extend'
import { register as registerOrchestrate } from './orchestrate'
import { register as registerActivity } from './activity'
import { register as registerMemory } from './memory'
import { register as registerWorkspace } from './workspace'
import { register as registerWindow } from './window'
import { register as registerPet } from './pet'

/** Register every ipcMain.handle channel, grouped by domain. */
export function registerAll(ipc: IpcMain): void {
  registerAuth(ipc)
  registerAgent(ipc)
  registerPersona(ipc)
  registerExtend(ipc)
  registerOrchestrate(ipc)
  registerActivity(ipc)
  registerMemory(ipc)
  registerWorkspace(ipc)
  registerWindow(ipc)
  registerPet(ipc)
}
