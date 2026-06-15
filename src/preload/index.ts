import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AuthStatus } from '../main/auth'
import type {
  AgentEvent,
  CompactProgress,
  RunOptions,
  Capabilities,
  SessionInfo,
  UsageInfo,
  TranscriptItem,
  Persona,
  QuestionResult
} from '../main/agent'
import type {
  SkillMeta,
  SkillDetail,
  SkillInput,
  SkillWriteResult
} from '../main/skills'
import type {
  CommandMeta,
  CommandDetail,
  CommandInput,
  CommandWriteResult
} from '../main/commands'
import type { HookRule } from '../main/hooks'
import type { McpServerEntry, McpSaveInput, McpSaveResult } from '../main/mcp'
import type {
  AgentMeta,
  AgentDetail,
  AgentInput,
  AgentWriteResult
} from '../main/agents'
import type { PluginEntry, PluginSaveResult } from '../main/plugins'
import type { ActivitySnapshot } from '../main/agentActivity'
import type { KeywordMatch } from '../main/keywords'

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
    respondDialog: (id: string, result: QuestionResult): Promise<void> =>
      ipcRenderer.invoke('agent:dialog-result', id, result),
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
    },
    /** Subscribe to /compact progress for the live progress bar. Returns unsubscribe. */
    onCompactProgress: (cb: (p: CompactProgress) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, payload: CompactProgress): void => cb(payload)
      ipcRenderer.on('agent:compact-progress', listener)
      return () => ipcRenderer.removeListener('agent:compact-progress', listener)
    }
  },
  persona: {
    get: (): Promise<Persona> => ipcRenderer.invoke('persona:get'),
    set: (persona: Persona): Promise<Persona> => ipcRenderer.invoke('persona:set', persona)
  },
  skills: {
    list: (): Promise<SkillMeta[]> => ipcRenderer.invoke('skills:list'),
    read: (name: string): Promise<SkillDetail | null> => ipcRenderer.invoke('skills:read', name),
    write: (input: SkillInput): Promise<SkillWriteResult> =>
      ipcRenderer.invoke('skills:write', input),
    delete: (name: string): Promise<SkillMeta[]> => ipcRenderer.invoke('skills:delete', name),
    toggle: (name: string, enabled: boolean): Promise<SkillMeta[]> =>
      ipcRenderer.invoke('skills:toggle', name, enabled)
  },
  commands: {
    list: (): Promise<CommandMeta[]> => ipcRenderer.invoke('commands:list'),
    read: (name: string): Promise<CommandDetail | null> =>
      ipcRenderer.invoke('commands:read', name),
    write: (input: CommandInput): Promise<CommandWriteResult> =>
      ipcRenderer.invoke('commands:write', input),
    delete: (name: string): Promise<CommandMeta[]> => ipcRenderer.invoke('commands:delete', name)
  },
  hooks: {
    list: (): Promise<HookRule[]> => ipcRenderer.invoke('hooks:list'),
    save: (rules: HookRule[]): Promise<HookRule[]> => ipcRenderer.invoke('hooks:save', rules)
  },
  mcp: {
    list: (): Promise<McpServerEntry[]> => ipcRenderer.invoke('mcp:list'),
    save: (input: McpSaveInput): Promise<McpSaveResult> => ipcRenderer.invoke('mcp:save', input),
    delete: (name: string): Promise<McpServerEntry[]> => ipcRenderer.invoke('mcp:delete', name)
  },
  agents: {
    list: (): Promise<AgentMeta[]> => ipcRenderer.invoke('agents:list'),
    read: (name: string): Promise<AgentDetail | null> => ipcRenderer.invoke('agents:read', name),
    write: (input: AgentInput): Promise<AgentWriteResult> =>
      ipcRenderer.invoke('agents:write', input),
    delete: (name: string): Promise<AgentMeta[]> => ipcRenderer.invoke('agents:delete', name)
  },
  plugins: {
    list: (): Promise<PluginEntry[]> => ipcRenderer.invoke('plugins:list'),
    add: (path: string): Promise<PluginSaveResult> => ipcRenderer.invoke('plugins:add', path),
    toggle: (path: string, enabled: boolean): Promise<PluginEntry[]> =>
      ipcRenderer.invoke('plugins:toggle', path, enabled),
    remove: (path: string): Promise<PluginEntry[]> => ipcRenderer.invoke('plugins:remove', path)
  },
  orchestrate: {
    /** Native magic-keyword detector (OMC port): map a typed prompt to active
     * modes (ralph/ultrathink/code-review/…). The only orchestration surface the
     * UI uses — the conductor engine is chat-driven only, not exposed here. */
    detectKeywords: (prompt: string): Promise<KeywordMatch[]> =>
      ipcRenderer.invoke('orchestrate:detect-keywords', prompt)
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close')
  },
  pet: {
    /** Current enabled state of the desktop pet. */
    getEnabled: (): Promise<boolean> => ipcRenderer.invoke('pet:get-enabled'),
    /** Set the pet on/off; resolves to the new enabled state. */
    setEnabled: (on: boolean): Promise<boolean> => ipcRenderer.invoke('pet:set-enabled', on),
    /** Toggle the pet; resolves to the new enabled state. */
    toggle: (): Promise<boolean> => ipcRenderer.invoke('pet:toggle')
  },
  activity: {
    /** Current live + persisted agent activity for the Squad dashboard. */
    snapshot: (): Promise<ActivitySnapshot> => ipcRenderer.invoke('activity:snapshot'),
    /** Clear persisted agent history; resolves to the fresh snapshot. */
    clear: (): Promise<ActivitySnapshot> => ipcRenderer.invoke('activity:clear'),
    /** Subscribe to live activity updates. Returns an unsubscribe fn. */
    onUpdate: (cb: (snap: ActivitySnapshot) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, payload: ActivitySnapshot): void => cb(payload)
      ipcRenderer.on('activity:update', listener)
      return () => ipcRenderer.removeListener('activity:update', listener)
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('forge', forge)
} else {
  // Context isolation off → define directly on window (no contextBridge).
  const w = window as unknown as { forge: Forge }
  w.forge = forge
}

export type Forge = typeof forge
