import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AuthStatus } from '../main/auth'
import type {
  AgentEvent,
  RunOptions,
  Capabilities,
  SessionInfo,
  UsageInfo,
  TranscriptItem,
  Persona
} from '../main/agent'

/** The safe surface exposed to the renderer as window.forge. */
const forge = {
  auth: {
    status: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:status'),
    useSubscription: (): Promise<void> => ipcRenderer.invoke('auth:set-subscription'),
    useOAuthToken: (token: string): Promise<void> =>
      ipcRenderer.invoke('auth:set-oauth-token', token),
    useApiKey: (key: string): Promise<void> => ipcRenderer.invoke('auth:set-api-key', key),
    clear: (): Promise<void> => ipcRenderer.invoke('auth:clear')
  },
  agent: {
    start: (runId: string, prompt: string, opts?: RunOptions): Promise<void> =>
      ipcRenderer.invoke('agent:start', runId, prompt, opts),
    interrupt: (runId: string): Promise<void> => ipcRenderer.invoke('agent:interrupt', runId),
    respondPermission: (id: string, allow: boolean): Promise<void> =>
      ipcRenderer.invoke('agent:permission-result', id, allow),
    capabilities: (): Promise<Capabilities> => ipcRenderer.invoke('agent:capabilities'),
    sessions: (): Promise<SessionInfo[]> => ipcRenderer.invoke('agent:sessions'),
    usage: (): Promise<UsageInfo> => ipcRenderer.invoke('agent:usage'),
    transcript: (sessionId: string): Promise<TranscriptItem[]> =>
      ipcRenderer.invoke('agent:transcript', sessionId),
    compact: (sessionId: string): Promise<{ ok: boolean; sessionId: string; error?: string }> =>
      ipcRenderer.invoke('agent:compact', sessionId),
    /** Subscribe to streaming events. Returns an unsubscribe function. */
    onEvent: (cb: (ev: AgentEvent) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, payload: AgentEvent): void => cb(payload)
      ipcRenderer.on('agent:event', listener)
      return () => ipcRenderer.removeListener('agent:event', listener)
    }
  },
  persona: {
    get: (): Promise<Persona> => ipcRenderer.invoke('persona:get'),
    set: (persona: Persona): Promise<Persona> => ipcRenderer.invoke('persona:set', persona)
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close')
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('forge', forge)
} else {
  // @ts-ignore - define on window when context isolation is off
  window.forge = forge
}

export type Forge = typeof forge
