// Shared renderer types. Leaf module (docs/MAINTAINABILITY.md Phase 0): it imports
// only the main-process type declarations (erased at build) and never renderer
// components, so it can't introduce an import cycle. Everything here was extracted
// verbatim from App.tsx — behavior-preserving.

export type AuthMode = 'subscription' | 'oauth-token' | 'api-key'
export interface AuthStatus {
  mode: AuthMode | null
  hasExistingLogin: boolean
}

// Main-process types, re-exported so renderer code imports them from one place.
export type Effort = import('../../main/agent').Effort
export type Permission = import('../../main/agent').Permission
export type RunOptions = import('../../main/agent').RunOptions
export type ModelInfo = import('../../main/agent').ModelInfo
export type SlashCommand = import('../../main/agent').SlashCommand
export type Capabilities = import('../../main/agent').Capabilities
export type SessionInfo = import('../../main/agent').SessionInfo
export type SessionSearchHit = import('../../main/agent').SessionSearchHit
export type UsageInfo = import('../../main/agent').UsageInfo
export type TranscriptItem = import('../../main/agent').TranscriptItem
export type Attachment = import('../../main/agent').Attachment
export type AgentEvent = import('../../main/agent').AgentEvent
export type Persona = import('../../main/agent').Persona
export type SkillMeta = import('../../main/skills').SkillMeta
export type SkillDetail = import('../../main/skills').SkillDetail
export type CommandMeta = import('../../main/commands').CommandMeta
export type HookRule = import('../../main/hooks').HookRule
export type McpServer = import('../../main/agent').McpServer
export type McpServerEntry = import('../../main/mcp').McpServerEntry
export type McpTransport = import('../../main/mcp').McpTransport
export type AgentMeta = import('../../main/agents').AgentMeta
export type PluginEntry = import('../../main/plugins').PluginEntry
export type ProviderEntry = import('../../main/providers').ProviderEntry
export type ProviderSaveInput = import('../../main/providers').ProviderSaveInput

// Agent-activity dashboard types (the Squad/Cost tabs read these).
export type AgentActivity = import('../../main/agentActivity').AgentActivity
export type ActivitySnapshot = import('../../main/agentActivity').ActivitySnapshot
export type ToolEvent = import('../../main/agentActivity').ToolEvent
export type KeywordMatch = import('../../main/keywords').KeywordMatch
export type LazyLevel = import('../../main/lazy').LazyLevel
/** Persisted lazy-mode setting: the three intensities plus an explicit off. */
export type LazySetting = LazyLevel | 'off'
export type WorkspaceFile = import('../../main/workspace').WorkspaceFile
export type MemoryEntry = import('../../main/memory').MemoryEntry
export type MemoryKind = import('../../main/memory').MemoryKind

export type EffortLabel = 'AUTO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH' | 'MAX'

export interface RunMeta {
  costUsd?: number
  durationMs?: number
  error?: string
}

export type Block =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      toolId: string
      name: string
      inputRaw: string
      status: 'running' | 'ok' | 'error'
      result?: string
      /** SDK parent_tool_use_id: when set, this tool was run by a subagent (the
       * Task tool_use that spawned it). Used to nest subagent tools under their
       * parent Task in the transcript (mirrors the Agents dashboard). */
      parentToolId?: string | null
    }

export interface Todo {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

export interface Turn {
  id: string
  prompt: string
  previews: string[]
  blocks: Block[]
  meta: RunMeta | null
  running: boolean
}

export interface PermReq {
  id: string
  toolName: string
  input: Record<string, unknown>
}

export interface DialogReq {
  id: string
  dialogKind: string
  payload: Record<string, unknown>
  toolUseID?: string
}

/** Answer to an AskUserQuestion prompt (matches the main-process QuestionResult). */
export type QResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

export interface DialogOption {
  label: string
  description?: string
  preview?: string
}
export interface DialogQuestion {
  question: string
  header?: string
  multiSelect?: boolean
  options: DialogOption[]
}

// (SquadAgent removed — the legacy parallel "manual squad" was deleted; the Squad
//  tab is orchestration-only. See docs/SQUAD_ORCHESTRATION.md §12-13.)
