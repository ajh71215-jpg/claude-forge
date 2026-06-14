// Auth IPC channels (docs/MAINTAINABILITY.md Phase 4). Extracted verbatim from
// the former src/main/index.ts.

import type { IpcMain } from 'electron'
import { getStatus, setSubscription, setOAuthToken, setApiKey, clearAuth } from '../auth'

export function register(ipc: IpcMain): void {
  // Auth IPC. The plaintext secret never crosses back to the renderer — only
  // status (mode + whether an existing login exists) is returned.
  ipc.handle('auth:status', () => getStatus())
  ipc.handle('auth:set-subscription', () => setSubscription())
  ipc.handle('auth:set-oauth-token', (_e, token: string) => setOAuthToken(token))
  ipc.handle('auth:set-api-key', (_e, key: string) => setApiKey(key))
  ipc.handle('auth:clear', () => clearAuth())
}
