// Workspace-inspection IPC: list/read the files in a conversation's isolated
// workspace so the UI can show what the agent edited, plus the structural repo
// map (Understand-Anything absorption). Local fs reads only — no model, no tokens.
import type { IpcMain } from 'electron'
import { listWorkspace, readWorkspaceFile } from '../workspace'
import { ensureWorkspace } from '../agent'
import { getRepoMap, type RepoMapResult } from '../repomap'

export function register(ipc: IpcMain): void {
  ipc.handle('workspace:list', (_e, id: string) => listWorkspace(id))
  ipc.handle('workspace:read', (_e, id: string, rel: string) => readWorkspaceFile(id, rel))
  ipc.handle('workspace:repo-map', async (_e, id: string): Promise<RepoMapResult> => {
    const cwd = await ensureWorkspace(id)
    return getRepoMap(cwd)
  })
}
