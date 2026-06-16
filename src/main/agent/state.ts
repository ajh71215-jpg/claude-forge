// Shared in-process run state (docs/MAINTAINABILITY.md Phase 4). The runner
// (runStreaming) fills these maps and the control methods (respondPermission,
// respondDialog, interruptRun) drain them — so they must live in one module both
// import. Single source of truth: the runId-keyed concurrency state is moved
// here verbatim, never duplicated.

import type { ActiveQuery, PermissionResult, QuestionResult } from './types'

// Active queries (for STOP), pending ASK prompts, and pending question prompts.
export const active = new Map<string, ActiveQuery>()
export const pendingPerms = new Map<string, (r: PermissionResult) => void>()
export const pendingDialogs = new Map<string, (r: QuestionResult) => void>()
