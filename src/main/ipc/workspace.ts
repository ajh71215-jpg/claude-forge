// Workspace-inspection IPC: list/read the files in a conversation's isolated
// workspace so the UI can show what the agent edited. Local fs reads only.
import type { IpcMain } from 'electron'
import { listWorkspace, readWorkspaceFile } from '../workspace'

export function register(ipc: IpcMain): void {
  ipc.handle('workspace:list', (_e, id: string) => listWorkspace(id))
  ipc.handle('workspace:read', (_e, id: string, rel: string) => readWorkspaceFile(id, rel))
}
