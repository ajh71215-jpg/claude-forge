// Pure observation masking (JetBrains "The Complexity Trap", arXiv:2508.21433):
// in a long agent trajectory, keep the most RECENT tool observations in full and
// replace OLDER ones with a compact placeholder, preserving the reasoning/action
// structure while halving cost — and, unlike summarization, with zero extra model
// calls and no "trajectory elongation" risk.
//
// HONEST ARCHITECTURAL LIMIT: Forge wraps the `claude` CLI, which owns its own
// message history inside the subprocess — Forge cannot rewrite that history
// mid-loop (the same reason the raw-API `clear_tool_uses` context-editing beta
// isn't reachable). So this masks only observation lists Forge itself constructs
// and forwards: the orchestration blackboard (prior-subtask outputs) and any
// aggregated context Forge assembles. NO electron/SDK imports → unit-tested.

import { estimateTokens } from './compress'

export interface Observation {
  /** Short provenance label, e.g. a subtask id or tool name. */
  label: string
  /** The raw observation text (tool output / prior result). */
  text: string
}

export interface MaskOptions {
  /** Keep this many most-recent observations in full. Default 2. */
  keepRecent?: number
  /** Don't mask an observation already shorter than this (masking wouldn't save). */
  minMaskTokens?: number
}

/**
 * Mask all but the `keepRecent` most-recent observations. Older ones become a
 * one-line `[<label>: output masked, ~N tokens]` placeholder so the model still
 * sees that the step happened (and can ask to re-surface it) without re-reading
 * the full payload every turn. Recent observations pass through untouched.
 * Returns the reassembled block (observations joined newest-last, original order).
 */
export function maskObservations(observations: Observation[], options: MaskOptions = {}): string {
  const keepRecent = Math.max(0, Math.floor(options.keepRecent ?? 2))
  const minMaskTokens = Math.max(0, options.minMaskTokens ?? 20)
  const n = observations.length
  const firstKept = Math.max(0, n - keepRecent)
  return observations
    .map((o, i) => {
      if (i >= firstKept) return o.text
      const tk = estimateTokens(o.text)
      if (tk < minMaskTokens) return o.text // too small to be worth masking
      return `[${o.label}: output masked, ~${tk} tokens — superseded by later steps]`
    })
    .join('\n\n')
}
