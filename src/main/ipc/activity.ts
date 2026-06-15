// IPC for the agent-activity dashboard (Squad tab redesign). The store itself
// (agentActivity.ts) taps the event bus and broadcasts 'activity:update'; these
// channels let the renderer pull the current snapshot and clear history.
import { type IpcMain } from 'electron'
import { getSnapshot, clearHistory, type ActivitySnapshot } from '../agentActivity'

export function register(ipc: IpcMain): void {
  ipc.handle('activity:snapshot', (): ActivitySnapshot => getSnapshot())
  ipc.handle('activity:clear', (): ActivitySnapshot => {
    clearHistory()
    return getSnapshot()
  })
}
