// Agent module barrel (docs/MAINTAINABILITY.md Phase 4). Re-exports the exact
// public surface of the former src/main/agent.ts so existing import paths
// (`./agent`, `../main/agent`, `../../main/agent`) keep resolving unchanged.

export type { Persona, PersonaMode } from '../persona'
export type {
  Effort,
  Permission,
  RunOptions,
  SessionInfo,
  ModelInfo,
  SlashCommand,
  McpServer,
  AccountInfo,
  Capabilities,
  UsageEntry,
  UsageInfo,
  Attachment,
  TranscriptItem,
  AgentEvent,
  CompactProgress,
  QuestionResult
} from './types'

export { workspaceDir, ensureWorkspace } from './env'
export { respondPermission, respondDialog, interruptRun, interruptAll } from './control'
export { getCapabilities } from './capabilities'
export { getUsage } from './usage'
export {
  getSessions,
  getTranscript,
  renameSession,
  deleteSession,
  searchSessions,
  type SessionSearchHit
} from './sessions'
export { compactSession } from './compact'
export { runStreaming } from './runStreaming'
