// IPC for the desktop pet toggle (docs/MAINTAINABILITY.md Phase 4 style). The
// drag / interactive channels are ipcMain.on handlers owned by pet/petWindow.ts;
// these are the invoke-style controls the main UI uses.
import { type IpcMain } from 'electron'
import { isPetEnabled, setPetEnabled, togglePet } from '../pet'

export function register(ipc: IpcMain): void {
  ipc.handle('pet:get-enabled', () => isPetEnabled())
  ipc.handle('pet:set-enabled', (_e, on: boolean) => setPetEnabled(!!on))
  ipc.handle('pet:toggle', () => togglePet())
}
