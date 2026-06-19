// Persistent project memory (absorbed from rohitg00/agentmemory). Barrel +
// the injection helper runStreaming calls at the start of a fresh conversation.

import { compressText, squeezeProse } from '../efficiency/compress'
import { allMemories, isMemoryEnabled, memoryBudgetTokens, recordAccess } from './store'
import { retrieve, assembleMemory } from './retrieve'

export { initMemoryCapture, noteRunWorkspace } from './capture'
export {
  isMemoryEnabled,
  setMemoryEnabled,
  isMemoryToolsEnabled,
  setMemoryToolsEnabled,
  listMemories,
  searchMemories,
  deleteMemory,
  clearMemories,
  memoryBudgetTokens
} from './store'
export { buildMemoryServer } from './memoryServer'
export type { MemoryEntry, MemoryKind } from './types'

export interface MemoryInjection {
  /** Ready-to-prepend context block, or '' when there is nothing to inject. */
  text: string
  count: number
}

/**
 * Build the memory block to prepend to a fresh conversation's first prompt.
 * Retrieves the most relevant captured facts for `query`, strengthens them
 * (usage boost), compresses to the configured token budget, and wraps them in a
 * clearly-labeled, caveated block. Returns '' when memory is off or empty — so
 * callers can inject unconditionally. Best-effort: any failure yields ''.
 */
export async function buildMemoryInjection(
  query: string,
  opts: { workspaceId?: string } = {}
): Promise<MemoryInjection> {
  try {
    if (!(await isMemoryEnabled())) return { text: '', count: 0 }
    const budget = await memoryBudgetTokens()
    const entries = await allMemories()
    const chosen = retrieve(entries, query, { budgetTokens: budget, workspaceId: opts.workspaceId })
    if (chosen.length === 0) return { text: '', count: 0 }
    await recordAccess(chosen.map((e) => e.id))
    // Memory facts are prose, so it's safe to drop low-signal filler (squeezeProse,
    // the model-free LLMLingua analog) before the budget-bounded compression.
    const body = compressText(squeezeProse(assembleMemory(chosen)), { maxTokens: budget }).text
    const text =
      '<project-memory>\n' +
      'Facts Forge auto-captured from earlier sessions in this project. They may ' +
      'be stale — verify against the current code before relying on them.\n' +
      body +
      '\n</project-memory>'
    return { text, count: chosen.length }
  } catch {
    return { text: '', count: 0 }
  }
}
