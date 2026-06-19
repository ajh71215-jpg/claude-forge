// Pure context-compression core — the portable idea absorbed from
// chopratejas/headroom (Apache-2.0): "same answers, a fraction of the tokens."
//
// Forge wraps the Claude Agent SDK, so it can't rewrite the SDK's own tool
// results mid-loop. What it CAN do is compress the context it constructs and
// controls itself — retrieved project memory, the repo map, orchestration
// blackboard context, and /goal resume context — before that text is ever
// injected into a prompt. This module is that compressor.
//
// Design constraints (matching the orchestration core): NO electron/SDK imports
// so it is unit-testable headlessly via `npm run test`. All functions are pure.
// Compression is lossy-but-marked: every elision leaves a visible marker stating
// how much was dropped, so a reader (human or model) knows context was trimmed
// rather than silently losing it (headroom's "reversible" principle, minus the
// on-demand-retrieval round-trip which the SDK loop can't host).

export interface CompressOptions {
  /** Hard cap on output tokens (~chars/4). 0/undefined = no cap. */
  maxTokens?: number
  /** Collapse runs of >1 blank line down to a single blank line. Default true. */
  collapseBlankLines?: boolean
  /** Collapse runs of identical adjacent lines into `<line>  (×N)`. Default true. */
  dedupeLines?: boolean
  /** Strip trailing whitespace from every line. Default true. */
  trimTrailing?: boolean
  /** JSON string values longer than this are head-truncated. Default 240. */
  maxJsonString?: number
  /** JSON arrays are clipped to at most this many items. Default 24. */
  maxJsonArray?: number
}

export interface CompressResult {
  text: string
  originalChars: number
  compressedChars: number
  originalTokens: number
  compressedTokens: number
  /** Fraction of tokens REMOVED, 0..1 (1 = removed everything). */
  ratio: number
  /** True when a hard token cap forced head/tail elision. */
  truncated: boolean
}

const DEFAULTS: Required<Omit<CompressOptions, 'maxTokens'>> = {
  collapseBlankLines: true,
  dedupeLines: true,
  trimTrailing: true,
  maxJsonString: 240,
  maxJsonArray: 24
}

/**
 * Cheap, provider-agnostic token estimate (~4 chars/token). Deliberately not a
 * real tokenizer — Forge has no tokenizer in-process and this only needs to be
 * good enough to budget injected context. Consistently used everywhere so the
 * ratios are internally comparable.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Does the trimmed text look like a JSON object/array we can re-serialize? */
function looksLikeJson(s: string): boolean {
  const t = s.trim()
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
}

/** Recursively clip long strings and large arrays in a parsed JSON value. */
function clipJson(value: unknown, opt: Required<Omit<CompressOptions, 'maxTokens'>>): unknown {
  if (typeof value === 'string') {
    if (value.length > opt.maxJsonString) {
      return value.slice(0, opt.maxJsonString) + `…(+${value.length - opt.maxJsonString} chars)`
    }
    return value
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, opt.maxJsonArray).map((v) => clipJson(v, opt))
    if (value.length > opt.maxJsonArray) kept.push(`…(+${value.length - opt.maxJsonArray} more items)`)
    return kept
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = clipJson(v, opt)
    return out
  }
  return value
}

/** Line-level dedup + whitespace normalization for prose / logs / tool output. */
function squeezeText(text: string, opt: Required<Omit<CompressOptions, 'maxTokens'>>): string {
  let lines = text.split('\n')
  if (opt.trimTrailing) lines = lines.map((l) => l.replace(/[ \t]+$/, ''))

  if (opt.dedupeLines) {
    const out: string[] = []
    let i = 0
    while (i < lines.length) {
      let n = 1
      while (i + n < lines.length && lines[i + n] === lines[i]) n++
      // Only collapse a run of a non-trivial line (>2 chars) seen 3+ times, so
      // we don't mangle ordinary repeated blanks/braces; blanks are handled below.
      if (n >= 3 && lines[i].trim().length > 2) out.push(`${lines[i]}  (×${n})`)
      else for (let k = 0; k < n; k++) out.push(lines[i])
      i += n
    }
    lines = out
  }

  if (opt.collapseBlankLines) {
    const out: string[] = []
    let blank = 0
    for (const l of lines) {
      if (l.trim() === '') {
        blank++
        if (blank <= 1) out.push('')
      } else {
        blank = 0
        out.push(l)
      }
    }
    lines = out
  }
  return lines.join('\n')
}

/**
 * If `text` exceeds the token budget, keep a head and a tail with a marker in
 * the middle stating exactly how much was elided. Head gets ~60% of the budget,
 * tail ~40% — the start (setup, signatures) and the end (results, conclusions)
 * are usually the most informative; the middle is the most droppable.
 */
function truncateToBudget(text: string, maxTokens: number): { text: string; truncated: boolean } {
  if (maxTokens <= 0 || estimateTokens(text) <= maxTokens) return { text, truncated: false }
  const budgetChars = maxTokens * 4
  const lines = text.split('\n')
  const headBudget = Math.floor(budgetChars * 0.6)
  const tailBudget = budgetChars - headBudget

  const head: string[] = []
  let headChars = 0
  let hi = 0
  for (; hi < lines.length; hi++) {
    const c = lines[hi].length + 1
    if (headChars + c > headBudget) break
    head.push(lines[hi])
    headChars += c
  }
  const tail: string[] = []
  let tailChars = 0
  let ti = lines.length - 1
  for (; ti >= hi; ti--) {
    const c = lines[ti].length + 1
    if (tailChars + c > tailBudget) break
    tail.unshift(lines[ti])
    tailChars += c
  }
  const elidedLines = ti - hi + 1
  const elidedChars = text.length - headChars - tailChars
  if (elidedLines <= 0) return { text, truncated: false }
  const marker = `… [${elidedLines} lines / ~${elidedChars} chars elided by Forge compression] …`
  return { text: [...head, marker, ...tail].join('\n'), truncated: true }
}

/**
 * Compress a single blob of context. Auto-routes: JSON gets structurally clipped
 * and minified; everything else gets line-dedup + whitespace squeeze. A maxTokens
 * cap then head/tail-truncates whatever remains.
 */
export function compressText(input: string, options: CompressOptions = {}): CompressResult {
  const opt = { ...DEFAULTS, ...options }
  const originalChars = input.length
  const originalTokens = estimateTokens(input)

  let body = input
  if (looksLikeJson(input)) {
    try {
      body = JSON.stringify(clipJson(JSON.parse(input), opt))
    } catch {
      body = squeezeText(input, opt)
    }
  } else {
    body = squeezeText(input, opt)
  }

  const cap = options.maxTokens ?? 0
  const { text, truncated } = truncateToBudget(body, cap)
  const compressedChars = text.length
  const compressedTokens = estimateTokens(text)
  return {
    text,
    originalChars,
    compressedChars,
    originalTokens,
    compressedTokens,
    ratio: originalTokens === 0 ? 0 : 1 - compressedTokens / originalTokens,
    truncated
  }
}

/**
 * Default ceiling for a Forge-CONSTRUCTED tool result / context blob that gets
 * carried in the prompt. The report's guidance is "keep tool responses under
 * 25,000 tokens"; Forge uses a tighter 8k default because such a result is then
 * re-sent on every subsequent turn (the O(n²) re-billing cost dominates), and a
 * delegated free-model answer rarely needs more than this. Tunable — the single
 * source of truth for the cap so callers don't hard-code their own number.
 */
export const FORGE_CONTEXT_TOKEN_CAP = 8000

export interface CapResult {
  text: string
  /** True when the input exceeded the cap and was head/tail-elided. */
  truncated: boolean
  /** Token estimate of the returned text (after any compression). */
  tokens: number
  /** Token estimate of the original input (before compression). */
  originalTokens: number
}

/**
 * Cap a Forge-OWNED tool result / context blob to a token budget, marked-lossy.
 * This is the one place Forge can apply the report's "bound large observations"
 * rule, since the SDK's own tool results (Read/Bash/…) are out of reach — only
 * the context Forge itself constructs (the goose `delegate` result, orchestration
 * blackboard context) flows through here. Always squeezes (dedup/whitespace);
 * only head/tail-elides above `maxTokens`. When trimmed, a one-line header tells
 * the model the blob was shortened so it can re-request a specific part.
 */
export function capToolResult(
  text: string,
  maxTokens: number = FORGE_CONTEXT_TOKEN_CAP,
  label = 'result'
): CapResult {
  const r = compressText(text, { maxTokens })
  const out = r.truncated
    ? `[Forge trimmed this ${label} from ~${r.originalTokens} to ~${r.compressedTokens} tokens to keep context small; ask again for a specific part if you need more.]\n${r.text}`
    : r.text
  return {
    text: out,
    truncated: r.truncated,
    tokens: estimateTokens(out),
    originalTokens: r.originalTokens
  }
}

// Low-signal filler PHRASES that are safe to drop from injected PROSE context
// without changing meaning. We target known-redundant phrases rather than doing
// stopword removal (which corrupts code and can change meaning) — the safe,
// model-free analog of LLMLingua's perplexity-based token dropping. True
// LLMLingua needs a small LM to score tokens, which Forge has no in-process
// equivalent for, so this is deliberately conservative.
const FILLER: [RegExp, string][] = [
  [/\bin order to\b/gi, 'to'],
  [/\bplease note that\b/gi, ''],
  [/\bit (?:is|'s) (?:worth|important) (?:noting|to note) that\b/gi, ''],
  [/\bas (?:you can|we can) see\b/gi, ''],
  [/\bplease\b/gi, ''],
  [/\bbasically\b/gi, ''],
  [/\bessentially\b/gi, ''],
  [/\bvery\b/gi, ''],
  [/\bin general\b/gi, ''],
  [/\bof course\b/gi, '']
]

/**
 * Squeeze injected PROSE (memory facts, retrieved-chunk headers) by dropping
 * low-signal filler phrases + tightening whitespace. Conservative and model-free
 * — NOT to be applied to code (it only removes English filler words/phrases).
 * Safe to no-op: returns the input minus filler, never reorders or rewrites.
 */
export function squeezeProse(input: string): string {
  let s = input
  for (const [re, rep] of FILLER) s = s.replace(re, rep)
  return s
    .replace(/[ \t]{2,}/g, ' ') // collapse internal whitespace runs
    .replace(/ +([,.;:!?])/g, '$1') // no space before punctuation
    .replace(/\n[ \t]+/g, '\n') // strip leading indent on prose lines
    .replace(/[ \t]+\n/g, '\n') // strip trailing whitespace
    .trim()
}

export interface ContextPart {
  /** Short label rendered as a section header (e.g. "memory", "repo map"). */
  label: string
  text: string
}

/**
 * Assemble several labeled context parts into one block within a total token
 * budget. Each part is compressed first; if the combined result still exceeds
 * the budget, every part is truncated to a share proportional to its size (with
 * a small floor so no part is starved to nothing). Returns the assembled string
 * plus a roll-up CompressResult so callers can log the savings.
 */
export function compressContext(
  parts: ContextPart[],
  budgetTokens: number,
  options: CompressOptions = {}
): CompressResult {
  const nonEmpty = parts.filter((p) => p.text.trim().length > 0)
  const originalChars = nonEmpty.reduce((s, p) => s + p.text.length, 0)
  const originalTokens = estimateTokens(nonEmpty.map((p) => p.text).join('\n'))

  // First pass: structural compression with no per-part cap.
  const compressed = nonEmpty.map((p) => ({ label: p.label, r: compressText(p.text, options) }))
  const total = compressed.reduce((s, c) => s + c.r.compressedTokens, 0)

  let final = compressed
  let truncated = compressed.some((c) => c.r.truncated)
  if (budgetTokens > 0 && total > budgetTokens) {
    const floor = Math.max(1, Math.floor(budgetTokens / (compressed.length * 4)))
    final = compressed.map((c) => {
      const share = Math.max(floor, Math.round((c.r.compressedTokens / total) * budgetTokens))
      const r = compressText(c.r.text, { ...options, maxTokens: share })
      if (r.truncated) truncated = true
      return { label: c.label, r }
    })
  }

  const text = final.map((c) => `## ${c.label}\n${c.r.text}`).join('\n\n')
  const compressedTokens = estimateTokens(text)
  return {
    text,
    originalChars,
    compressedChars: text.length,
    originalTokens,
    compressedTokens,
    ratio: originalTokens === 0 ? 0 : 1 - compressedTokens / originalTokens,
    truncated
  }
}
