// Agent run + control IPC channels (docs/MAINTAINABILITY.md Phase 4). Extracted
// verbatim from the former src/main/index.ts.

import type { IpcMain } from 'electron'
import {
  runStreaming,
  interruptRun,
  respondPermission,
  respondDialog,
  type QuestionResult,
  getCapabilities,
  getSessions,
  getUsage,
  getTranscript,
  compactSession,
  renameSession,
  deleteSession,
  searchSessions,
  type RunOptions
} from '../agent'

export function register(ipc: IpcMain): void {
  // Streaming run — events are pushed back on 'agent:event'.
  ipc.handle('agent:start', (e, runId: string, prompt: string, opts?: RunOptions) =>
    runStreaming(e.sender, runId, prompt, opts ?? {})
  )
  ipc.handle('agent:interrupt', (_e, runId: string) => interruptRun(runId))
  ipc.handle('agent:permission-result', (_e, id: string, allow: boolean) =>
    respondPermission(id, allow)
  )
  ipc.handle('agent:dialog-result', (_e, id: string, result: QuestionResult) =>
    respondDialog(id, result)
  )
  ipc.handle('agent:capabilities', () => getCapabilities())
  ipc.handle('agent:sessions', () => getSessions())
  ipc.handle('agent:usage', () => getUsage())
  ipc.handle('agent:transcript', (_e, sessionId: string) => getTranscript(sessionId))
  ipc.handle('agent:compact', (e, sessionId: string, workspaceId?: string) =>
    compactSession(sessionId, e.sender, workspaceId)
  )
  ipc.handle('agent:rename-session', (_e, sessionId: string, title: string) =>
    renameSession(sessionId, title)
  )
  ipc.handle('agent:delete-session', (_e, sessionId: string) => deleteSession(sessionId))
  ipc.handle('agent:search-sessions', (_e, query: string) => searchSessions(query))
}
