// Native magic-keyword detector — the portable core of oh-my-claudecode's
// keyword-detector hook (templates/hooks/keyword-detector.mjs) reimplemented as
// a pure function so the Forge Squad can auto-route a typed goal/prompt to an
// orchestration MODE (loop, role assignment, reasoning boost) without a Claude
// Code plugin hook. No electron/SDK imports → headlessly testable (npm run
// selftest), same contract as orchestration.ts / routing.ts / roles.ts.
//
// The hard part OMC solved is NOT spotting the word "ralph" — it is NOT firing
// on it when the user is only TALKING ABOUT ralph (asking what it is, pasting a
// prior "[RALPH LOOP - ITERATION N]" echo, quoting docs). Those false-positive
// guards are the real value, so they are ported faithfully (in compact form):
// sanitize code/URLs → strip system echoes → reject informational / quoted /
// reference contexts → map surviving keywords to a Forge mode + priority order.

import type { Topology } from './orchestration'
import type { Tier } from './routing'
import { lazyDirective } from './lazy'

/** What a detected keyword DOES inside Forge's orchestration engine. */
export type KeywordAction =
  | 'loop' // ralph / autopilot → run the plan until the goal verifies (runLoop)
  | 'parallel' // ultrawork → favor fan-out topologies for independent work
  | 'reason' // ultrathink → append an extended-reasoning directive
  | 'role' // code-review / security-review / tdd / deepsearch / analyze → assign a role
  | 'delegate' // cheap / delegate → prefer offloading simple subtasks to free models
  | 'style' // ponytail / lazy mode → change code-generation discipline (no orchestration change)
  | 'cancel' // cancelomc / stopomc → clear any active mode

export interface KeywordMode {
  /** Canonical mode name (matches OMC skill names where they overlap). */
  name: string
  action: KeywordAction
  /** Lower runs first when several fire (OMC priority order). */
  priority: number
  /** For action:'role' — the roles.ts role this keyword maps a subtask to. */
  role?: string
  /** Topology hint the UI/seed-plan may apply. */
  topology?: Topology
  /** Default tier hint. */
  tier?: Tier
  /** Directive appended to the system prompt when this mode is active. */
  systemAppend?: string
}

export interface KeywordMatch extends KeywordMode {
  /** The literal substring that triggered the match (for UI display). */
  matched: string
}

// ── Mode table ─────────────────────────────────────────────────────────────
// Each entry: detection regex (case-insensitive, incl. KO/JA aliases ported
// from the .mjs) + the Forge mode it activates. Priority mirrors OMC's
// resolveConflicts() priorityOrder so combined keywords resolve identically.
interface ModeSpec extends KeywordMode {
  pattern: RegExp
}

const MODES: ModeSpec[] = [
  {
    name: 'cancel',
    action: 'cancel',
    priority: 0,
    // Also deactivates lazy mode: "stop ponytail" / "normal mode" (ponytail's off switch).
    pattern: /\b(cancelomc|stopomc|stop\s+ponytail|normal\s+mode)\b|(포니테일\s?(?:꺼|끄|종료|중지))|(ポニーテール\s?(?:停止|オフ))/i,
    systemAppend:
      'Cancel any active autonomous or lazy mode (ralph/autopilot/ultrawork/ponytail). Resume normal one-shot work.'
  },
  {
    name: 'ralph',
    action: 'loop',
    priority: 1,
    tier: 'sonnet',
    // (랄프)(?!로렌) / (ラルフ)(?!・?ローレン): exclude "Ralph Lauren".
    pattern: /\b(ralph)\b|(랄프)(?!로렌)|(ラルフ)(?!・?ローレン)/i,
    systemAppend:
      'RALPH MODE: persist until the goal is fully verified ("the boulder never stops"). ' +
      'Re-attempt failing work each iteration; never stop at a partial result.'
  },
  {
    name: 'autopilot',
    action: 'loop',
    priority: 2,
    tier: 'sonnet',
    pattern: /\b(autopilot|auto[\s-]?pilot|fullsend|full\s+auto)\b|(오토파일럿)|(オートパイロット)/i,
    systemAppend:
      'AUTOPILOT MODE: execute the whole plan autonomously to completion, looping on failures, ' +
      'without pausing for confirmation between steps.'
  },
  {
    name: 'ultrawork',
    action: 'parallel',
    priority: 3,
    topology: 'fanout',
    pattern: /\b(ultrawork|ulw)\b|(울트라워크)|(ウルトラワーク)/i,
    systemAppend:
      'ULTRAWORK MODE: maximize parallelism — decompose into independent subtasks and fan them out ' +
      'concurrently rather than working serially.'
  },
  {
    name: 'tdd',
    action: 'role',
    priority: 9,
    role: 'test-engineer',
    pattern: /\b(tdd|test\s+first|red\s+green)\b|(테스트\s?퍼스트)|(テスト\s?ファースト)/i,
    systemAppend:
      'TDD MODE: write or update the test first, confirm it fails for the right reason, then implement ' +
      'the minimal change and re-run to green.'
  },
  {
    name: 'code-review',
    action: 'role',
    priority: 10,
    role: 'code-reviewer',
    topology: 'debate',
    pattern: /\b(code\s+review|review\s+code)\b|(코드\s?리뷰)(?!어)|(コード\s?レビュー)(?!ア)/i,
    systemAppend:
      'CODE REVIEW MODE: review for correctness, maintainability, edge cases, regressions, and test ' +
      'adequacy. Rate findings by severity with file:line.'
  },
  {
    name: 'security-review',
    action: 'role',
    priority: 11,
    role: 'security-reviewer',
    topology: 'debate',
    pattern: /\b(security\s+review|review\s+security)\b|(보안\s?리뷰)(?!어)|(セキュリティ[ー]?\s?レビュー)(?!ア)/i,
    systemAppend:
      'SECURITY REVIEW MODE: check trust boundaries, auth/authz, data exposure, input validation, ' +
      'secrets handling, and escalation risks. Each finding needs a concrete exploit path.'
  },
  {
    name: 'cheap',
    action: 'delegate',
    priority: 8,
    pattern: /\b(cheap|cheapmode|delegate|budget[\s-]?mode)\b|(저렴|아껴|절약)|(節約|安く)/i,
    systemAppend:
      'CHEAP MODE: aggressively conserve budget. For any self-contained, low-stakes subtask ' +
      '(summaries, drafts, classification, lookups, simple edits, boilerplate), use the `delegate` ' +
      'tool to offload it to a free model instead of doing it yourself. Verify each delegated result ' +
      'before relying on it; keep only genuinely hard reasoning for yourself.'
  },
  {
    name: 'ponytail',
    action: 'style',
    priority: 7,
    // "lazy" alone is too common → require an explicit mode phrase. Korean
    // 게으른 모드 / 최소 코드, Japanese ポニーテール / 怠惰モード.
    pattern:
      /\bponytail\b|\blazy\s+(?:mode|coding|dev|senior|coder)\b|\b(?:laziest|simplest)\s+(?:solution|thing|approach|version)\b|(포니테일|게으른\s?모드|최소\s?코드)|(ポニーテール|怠惰\s?モード)/i,
    systemAppend: lazyDirective('full')
  },
  {
    name: 'ultrathink',
    action: 'reason',
    priority: 12,
    tier: 'opus',
    pattern: /\b(ultrathink)\b|(울트라씽크)|(ウルトラシンク)/i,
    systemAppend:
      'ULTRATHINK MODE: reason step-by-step from multiple angles, weigh edge cases and the implications ' +
      'of each approach, before acting.'
  },
  {
    name: 'deepsearch',
    action: 'role',
    priority: 13,
    role: 'explore',
    topology: 'fanout',
    pattern: /\b(deepsearch|search\s+the\s+codebase)\b|(딥\s?서치)|(ディープ\s?サーチ)/i,
    systemAppend:
      'DEEPSEARCH MODE: search exhaustively in parallel across the codebase; never stop at the first ' +
      'result. Report exact paths + line ranges.'
  },
  {
    name: 'analyze',
    action: 'role',
    priority: 14,
    role: 'analyst',
    pattern: /\b(deep[\s-]?analyze|deepanalyze)\b|(딥\s?분석)|(ディープ\s?アナライズ)/i,
    systemAppend:
      'ANALYZE MODE: gather context first — compare working vs broken behavior and synthesize findings ' +
      'before proposing changes.'
  }
]

// ── False-positive guards (ported, compact) ─────────────────────────────────

/** Strip code blocks, inline code, URLs, and file paths (.mjs sanitize step). */
function sanitize(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/`[^`]+`/g, ' ') // inline code
    .replace(/<!--[\s\S]*?-->/g, ' ') // comments
    .replace(/https?:\/\/[^\s)>\]]+/g, ' ') // URLs
    .replace(/^\s*>\s.*$/gm, ' ') // block quotes
}

// System-generated echo headers: pasting a prior "[RALPH LOOP - ITERATION N]"
// block must NOT re-activate the mode (self-reinforcing loop guard).
const ECHO_BLOCK =
  /\[(?:RALPH LOOP|AUTOPILOT|ULTRAWORK|ULTRAPILOT|TEAM|PIPELINE|SWARM|MAGIC KEYWORDS?(?:\s+DETECTED)?)[^\]\n]*\]/gi
const ECHO_SIGNATURE = /\bWhen FULLY complete \(after Architect verification\)\b|\[RALPH LOOP\s*-\s*ITERATION\b/i

function looksLikeSystemEcho(text: string): boolean {
  return ECHO_SIGNATURE.test(text) || ECHO_BLOCK.test(text)
}
function stripSystemEchoes(text: string): string {
  return text.replace(ECHO_BLOCK, ' ')
}

// "What is ralph / how do I use ... / 뭐야 / とは / 什么是" — informational, not
// activation. Ported from INFORMATIONAL_INTENT_PATTERNS.
const INFORMATIONAL = [
  /\b(?:what(?:'s|\s+is)|what\s+are|how\s+(?:to|do\s+i)\s+use|explain|tell\s+me\s+about|describe|difference\s+between)\b/i,
  /(?:뭐야|뭔데|무엇|어떻게|사용법|알려\s?줘|설명해?\s?줘|차이|뭐가\s*달라)/u,
  /(?:とは|って何|使い方|説明|違い|どう違う)/u,
  /(?:什么是|什麼是|怎么用|如何使用|解释|說明|说明)/u
]

// Activation intent overrides informational ("use ralph", "켜줘", "실행").
const ACTIVATION = [
  /\b(?:use|run|start|enable|activate|invoke|trigger|launch)\b/i,
  /(?:켜|켜줘|실행|시작|돌려|돌려줘|써|써줘|사용해|진행해)/u,
  /(?:実行|起動|開始|使って|やって)/u
]

const QUOTED_SPAN = /"[^"\n]{1,400}"|'[^'\n]{1,400}'|“[^”\n]{1,400}”|‘[^’\n]{1,400}’/g

function windowAround(text: string, index: number, len: number, radius = 80): string {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + len + radius))
}

function isWithinQuotedSpan(text: string, position: number): boolean {
  for (const m of text.matchAll(QUOTED_SPAN)) {
    if (m.index === undefined) continue
    if (position >= m.index && position < m.index + m[0].length) return true
  }
  return false
}

/**
 * True when the keyword at `index` is being DISCUSSED, not invoked: an
 * informational question nearby (and no activation verb), or it sits inside a
 * quoted span. Activation intent always wins.
 */
function isInformationalContext(text: string, index: number, len: number): boolean {
  const ctx = windowAround(text, index, len)
  if (ACTIVATION.some((re) => re.test(ctx))) return false
  if (isWithinQuotedSpan(text, index)) return true
  return INFORMATIONAL.some((re) => re.test(ctx))
}

/** Find the first actionable occurrence of a mode's pattern, or null. */
function firstActionable(text: string, spec: ModeSpec): string | null {
  const flags = spec.pattern.flags.includes('g') ? spec.pattern.flags : `${spec.pattern.flags}g`
  const re = new RegExp(spec.pattern.source, flags)
  for (const m of text.matchAll(re)) {
    if (m.index === undefined) continue
    if (isInformationalContext(text, m.index, m[0].length)) continue
    return m[0]
  }
  return null
}

/**
 * Detect every actionable magic keyword in a prompt and return the resulting
 * modes, sorted by OMC priority (cancel first; cancel is exclusive). Returns []
 * when the prompt only TALKS ABOUT the keywords (informational/echo/quoted).
 */
export function detectKeywords(prompt: string | undefined): KeywordMatch[] {
  if (!prompt || !prompt.trim()) return []
  const pre = looksLikeSystemEcho(prompt) ? stripSystemEchoes(prompt) : prompt
  const text = sanitize(pre)

  const matches: KeywordMatch[] = []
  for (const spec of MODES) {
    const hit = firstActionable(text, spec)
    if (hit === null) continue
    const { pattern: _p, ...mode } = spec
    matches.push({ ...mode, matched: hit.trim() })
  }
  if (matches.some((m) => m.action === 'cancel')) {
    return matches.filter((m) => m.action === 'cancel').slice(0, 1)
  }
  return matches.sort((a, b) => a.priority - b.priority)
}

/** True when any detected mode wants the autonomous loop (ralph/autopilot). */
export function keywordSuggestsLoop(matches: KeywordMatch[]): boolean {
  return matches.some((m) => m.action === 'loop')
}

/** Combined system-prompt directive for all active modes (in priority order). */
export function keywordSystemAppend(matches: KeywordMatch[]): string {
  return matches
    .map((m) => m.systemAppend)
    .filter((s): s is string => !!s)
    .join(' ')
}
