// Project-memory IPC (agentmemory absorption). Browse/search/delete/clear the
// auto-captured facts and toggle the subsystem. Pure local reads/writes — no
// model, no tokens. Capture + injection happen elsewhere (bus tap + runStreaming).
import type { IpcMain } from 'electron'
import {
  listMemories,
  searchMemories,
  deleteMemory,
  clearMemories,
  isMemoryEnabled,
  setMemoryEnabled,
  isMemoryToolsEnabled,
  setMemoryToolsEnabled
} from '../memory'

export function register(ipc: IpcMain): void {
  ipc.handle('memory:list', () => listMemories())
  ipc.handle('memory:search', (_e, query: string) => searchMemories(query))
  ipc.handle('memory:delete', (_e, id: string) => deleteMemory(id))
  ipc.handle('memory:clear', async () => {
    await clearMemories()
    return listMemories()
  })
  ipc.handle('memory:enabled', () => isMemoryEnabled())
  ipc.handle('memory:set-enabled', (_e, on: boolean) => setMemoryEnabled(on))
  // Progressive-disclosure MCP tools (claude-mem absorption) — opt-in.
  ipc.handle('memory:tools-enabled', () => isMemoryToolsEnabled())
  ipc.handle('memory:set-tools-enabled', (_e, on: boolean) => setMemoryToolsEnabled(on))
}
