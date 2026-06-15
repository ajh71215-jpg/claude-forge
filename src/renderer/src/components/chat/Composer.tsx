// The CHAT composer + live transcript (docs/MAINTAINABILITY.md Phase 2).
// Extracted verbatim from App.tsx — behavior-preserving. The streaming event
// subscription (rAF-coalesced) and near-bottom autoscroll are docs/PERFORMANCE.md
// levers 2 & 4 — do not change without re-profiling.
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type DragEvent as RDragEvent } from 'react'
import type {
  Permission,
  Effort,
  SlashCommand,
  ModelInfo,
  EffortLabel,
  TranscriptItem,
  Todo,
  RunOptions
} from '../../types'
import { CLIENT_COMMANDS } from '../../lib/constants'
import { ctxWindow, resolveMaxTurns, toolArg, toolIcon } from '../../lib/format'
// Shared model router (docs/TOKEN_OPTIMIZATION.md §3 lever 4 ∩ SQUAD §4): the
// cost-saver classifies each prompt's difficulty and routes to the cheapest tier
// that fits, instead of a flat "always Sonnet". Single owner — the conductor's
// cascade imports the same module, so the policy is never duplicated.
import { route, resolveModelId } from '../../../../main/routing'
import { deriveTasks, parseTodos } from '../../lib/blocks'
import { conversationToJson, conversationToMarkdown } from '../../lib/export'
import { useAgentEvents } from './useAgentEvents'
import HistoryView from './HistoryView'
import TurnView from './TurnView'
import TodoBar from './TodoBar'
import PermissionModal from './PermissionModal'
import QuestionModal from './QuestionModal'
import Elapsed from './Elapsed'
import type { Turn, KeywordMatch } from '../../types'

/** Plain-language description of what the agent is doing right now, derived from
 * the active turn's latest block — so the pinned live strip says e.g. "Read
 * src/main/agent.ts" or "thinking…" instead of an opaque "running". */
function activityLabel(turn: Turn | null): { icon: string; text: string } {
  const b = turn?.blocks[turn.blocks.length - 1]
  if (!b) return { icon: '✦', text: 'thinking…' }
  if (b.kind === 'thinking') return { icon: '✦', text: 'thinking…' }
  if (b.kind === 'text') return { icon: '✎', text: 'writing response…' }
  // tool block
  if (b.status === 'running') {
    const arg = toolArg(b.inputRaw)
    return { icon: toolIcon(b.name), text: arg ? `${b.name} ${arg}` : `${b.name}…` }
  }
  return { icon: '⚒', text: 'working…' }
}

/** Live state for the autonomous /goal loop (Forge's headless analog of the
 * interactive Claude Code /goal: re-run the resumed session until the model
 * signals GOAL_ACHIEVED, an error, the iteration cap, or the cumulative budget). */
interface GoalState {
  objective: string
  iter: number
  max: number
  /** USD spent across all iterations so far (sum of per-run result costs). */
  spent: number
  /** Cumulative USD cap — the loop hard-stops once `spent` reaches it. This is the
   * runaway guard the per-run maxBudgetUsd can't provide (it resets each run). */
  budget: number
}

/** Default cumulative USD ceiling for a /goal loop, used unless the user has set a
 * higher LIMITS "max $/run" (then that value is the goal's total budget). */
const GOAL_MAX_USD = 10

/** Directive that turns one run into a goal-loop step. Injected as a prefix on the
 * user message (not the system prompt) so it doesn't bust the prompt cache; the
 * agent keeps all its real tools + the user's permission mode. */
function goalDirective(objective: string): string {
  return [
    'GOAL MODE — autonomous objective loop.',
    `Objective: ${objective}`,
    'Work toward this objective using your available tools. This runs in a loop:' +
      ' after each turn you are automatically prompted to continue, so you need not' +
      ' finish everything at once — make concrete, verifiable progress each turn.',
    'At the VERY END of every response, output exactly one status token on its own line:',
    '- GOAL_ACHIEVED — only when the objective is fully complete AND verified' +
      ' (prefer running tests / build / typecheck to confirm before declaring done).',
    '- GOAL_CONTINUE — when more work remains; briefly state the next concrete step.',
    'Do not output GOAL_ACHIEVED prematurely.'
  ].join('\n')
}

/** Did the assistant's response declare the goal complete? Last token wins so a
 * response that discusses GOAL_CONTINUE earlier but ends with GOAL_ACHIEVED
 * still resolves correctly (and vice-versa). */
function goalAchieved(text: string): boolean {
  const ach = text.lastIndexOf('GOAL_ACHIEVED')
  if (ach < 0) return false
  return ach > text.lastIndexOf('GOAL_CONTINUE')
}

/** Interactive-only CLI commands with no headless behavior — surfaced with a
 * clear note instead of being silently forwarded to the SDK (where they no-op). */
const INTERACTIVE_ONLY = new Set([
  'login',
  'logout',
  'agents',
  'ide',
  'bug',
  'vim',
  'terminal-setup',
  'install-github-app'
])

/** Flatten a turn's searchable text (prompt + every block) for transcript search. */
function turnText(t: Turn): string {
  const parts = [t.prompt]
  for (const b of t.blocks) {
    if (b.kind === 'text' || b.kind === 'thinking') parts.push(b.text)
    else if (b.kind === 'tool') parts.push(b.name, b.inputRaw, b.result ?? '')
  }
  return parts.join(' ').toLowerCase()
}

export default function Composer({
  model,
  permission,
  effort,
  commands,
  models,
  maxTurnsByModel,
  maxBudget,
  autoCompact,
  costSaver,
  onResult,
  sessionId,
  sessionKey,
  onSession,
  onSetModel,
  onSetConvPersona,
  onSetEffort,
  onSetPermission,
  onNewSession,
  workspaceId,
  isActive = true,
  convPersona
}: {
  model?: string
  permission: Permission
  effort?: Effort
  commands: SlashCommand[]
  models: ModelInfo[]
  /** Per-model max-turns overrides (model id → turns). Default applied per model. */
  maxTurnsByModel: Record<string, number>
  maxBudget: number
  autoCompact: boolean
  /** Cost-saver mode: route each prompt to a tier by difficulty (lever 4). */
  costSaver: boolean
  onResult: (r: {
    costUsd?: number
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    contextTokens?: number
  }) => void
  sessionId: string | null
  sessionKey: number
  onSession: (id: string) => void
  /** Set this conversation's model override (via /model). */
  onSetModel: (value: string) => void
  /** Set/clear this conversation's persona override (via /persona). */
  onSetConvPersona: (text: string | null) => void
  onSetEffort: (label: EffortLabel) => void
  onSetPermission: (p: Permission) => void
  onNewSession: () => void
  /** Isolated workspace id for this conversation (per-tab) — keeps concurrent
   * conversations from editing the same files. Threaded into every run. */
  workspaceId?: string
  /** True when this is the visible tab. All tabs stay mounted (so background
   * conversations keep streaming), so global side effects (Cmd+F, focus) must be
   * gated on this to avoid firing in every tab at once. */
  isActive?: boolean
  /** This conversation's persona override (set via /persona); when set it's sent
   * as the run's systemPrompt (replace), overriding the global persona. */
  convPersona?: string
}): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [menuIndex, setMenuIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [compactPct, setCompactPct] = useState(0)
  const [history, setHistory] = useState<TranscriptItem[]>([])
  const [attachments, setAttachments] = useState<
    { id: string; mediaType: string; base64: string; preview: string; name: string }[]
  >([])
  // Drag-and-drop image attach overlay + transcript search box.
  const [dragOver, setDragOver] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  // Magic-keyword modes detected in the current draft (shown as chips so the
  // trigger is discoverable before sending).
  const [detectedModes, setDetectedModes] = useState<KeywordMatch[]>([])
  const [histIndex, setHistIndex] = useState<number | null>(null)
  // /goal autonomous loop. goalRef mirrors the state synchronously so send() and
  // the loop-driving effect see the current goal without waiting for a re-render.
  const [goal, setGoalState] = useState<GoalState | null>(null)
  const goalRef = useRef<GoalState | null>(null)
  const setGoal = useCallback((g: GoalState | null): void => {
    goalRef.current = g
    setGoalState(g)
  }, [])
  const processedTurnRef = useRef<string | null>(null)
  // Auto-scroll mode. true = pin to latest line (follow); false = only nudge
  // when already near bottom (legacy — streaming text won't yank a reader down).
  const [stickBottom, setStickBottom] = useState<boolean>(() => {
    try {
      return localStorage.getItem('forge-stick-bottom') !== '0'
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('forge-stick-bottom', stickBottom ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [stickBottom])
  const promptHistRef = useRef<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const runIdRef = useRef<string | null>(null)
  const ownedRef = useRef<Set<string>>(new Set())
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult
  const onSessionRef = useRef(onSession)
  onSessionRef.current = onSession
  const sessionIdRef = useRef<string | null>(sessionId)
  sessionIdRef.current = sessionId
  const taRef = useRef<HTMLTextAreaElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  // Stable handlers for the memoized TurnView so completed turns don't re-render
  // on every streaming flush. Route retry through a ref so a completed turn's
  // button always calls the latest send (current model/options) without changing
  // identity and breaking memo. docs/PERFORMANCE.md lever 3.
  const sendRef = useRef<((textArg?: string) => Promise<void>) | undefined>(undefined)
  sendRef.current = send
  const handleRetry = useCallback((p: string) => {
    void sendRef.current?.(p)
  }, [])
  const handleEdit = useCallback((p: string) => {
    setPrompt(p)
    taRef.current?.focus()
  }, [])

  // Live event-driven transcript state + the single streaming subscription. The
  // hook owns turns/perms/dialogs/context and the rAF-coalesced event routing
  // (docs/PERFORMANCE.md lever 2); Composer reads them and mutates the setters
  // from its own handlers (send / compact / session-restore).
  const {
    turns,
    setTurns,
    perms,
    setPerms,
    dialogs,
    setDialogs,
    contextTokens,
    setContextTokens,
    contextModel,
    setContextModel,
    reliability,
    setReliability
  } = useAgentEvents({ ownedRef, runIdRef, onSessionRef, onResultRef, taRef })

  // Keep the transcript pinned to the bottom as content streams in — but only
  // when the user is already near the bottom (don't yank them down if they
  // scrolled up to read), and via rAF so scrollTop is written at most once per
  // frame instead of forcing a layout on every delta. docs/PERFORMANCE.md lever 4.
  useEffect(() => {
    const el = transcriptRef.current
    if (!el) return
    // Follow mode pins unconditionally; legacy mode only nudges when the user is
    // already near the bottom (don't yank them down mid-read).
    if (!stickBottom) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      if (!nearBottom) return
    }
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(id)
  }, [turns, stickBottom])

  // Load persisted prompt history once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('forge-prompt-history')
      if (raw) promptHistRef.current = JSON.parse(raw)
    } catch {
      /* ignore */
    }
  }, [])

  // Reset the visible transcript when starting a new / resumed conversation;
  // restore the past transcript when resuming an existing session.
  useEffect(() => {
    // Switching to another conversation orphans any run still streaming on this
    // one — interrupt it so it doesn't keep spending tokens (and cost) in the
    // background where its output can no longer be shown.
    if (runIdRef.current) window.forge.agent.interrupt(runIdRef.current)
    setTurns([])
    setPerms([])
    setDialogs([])
    setAttachments([])
    setContextTokens(0)
    setContextModel('')
    runIdRef.current = null
    setGoal(null) // switching conversations abandons any in-flight goal loop
    processedTurnRef.current = null
    const sid = sessionIdRef.current
    if (sid) {
      window.forge.agent
        .transcript(sid)
        .then((items) => {
          setHistory(items)
          // Seed the context gauge from the restored transcript (~4 chars/token)
          // so a resumed conversation doesn't read 0% until the next turn; the
          // next result event replaces this estimate with the exact token count.
          const chars = items.reduce(
            (n, it) =>
              n +
              (('text' in it && it.text) || '').length +
              (('result' in it && it.result) || '').length,
            0
          )
          if (chars > 0) setContextTokens(Math.round(chars / 4))
        })
        .catch(() => setHistory([]))
    } else {
      setHistory([])
    }
    // Re-run only on conversation switch; the setters (from useAgentEvents/useState)
    // are stable, so they're intentionally omitted from the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey])

  const running = turns.some((t) => t.running)
  const activeTurn = turns.find((t) => t.running) ?? null

  // Task progress for the pinned bar above the composer. Models track work via
  // the Task tools (TaskCreate/TaskUpdate/TaskList), so reconstruct from those;
  // fall back to TodoWrite for any agent that still uses it.
  const taskTodos = deriveTasks(turns)
  let latestTodos: Todo[] | null = taskTodos.length ? taskTodos : null
  if (!latestTodos) {
    outer: for (let i = turns.length - 1; i >= 0; i--) {
      const blocks = turns[i].blocks
      for (let j = blocks.length - 1; j >= 0; j--) {
        const b = blocks[j]
        if (b.kind === 'tool' && b.name === 'TodoWrite') {
          const todos = parseTodos(b.inputRaw)
          if (todos && todos.length) {
            latestTodos = todos
            break outer
          }
        }
      }
    }
  }

  // Live /compact progress for the progress bar (main streams agent:compact-progress).
  useEffect(() => {
    const unsub = window.forge.agent.onCompactProgress((p) => {
      // Only this conversation's compact drives this composer's bar — the IPC is
      // broadcast to every mounted tab, so filter on our session id (H1).
      if (p.sessionId === sessionIdRef.current) setCompactPct(p.pct)
    })
    return unsub
  }, [])

  // Auto-compact when context crosses 80% (opt-in via the LIMITS toggle).
  useEffect(() => {
    if (!autoCompact || compacting || running || !sessionIdRef.current || contextTokens <= 0) return
    const pct = (contextTokens / ctxWindow(contextModel)) * 100
    if (pct >= 80) compact()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextTokens])

  // Cost-saver routing (lever 4): classify the prompt's difficulty and pick the
  // cheapest tier that fits, resolving the tier alias to a concrete model id from
  // the live model list. Effort is dropped for models that report no effort
  // control (e.g. Haiku) — sending an unsupported level would error, mirroring
  // the manual EFFORT guard in App.
  function routeCostSaver(text: string): {
    model: string
    effort?: Effort
    tier: string
    difficulty: string
  } {
    const d = route({ instruction: text })
    const m = resolveModelId(d.tier, models)
    const levels = models.find((x) => x.value === m)?.supportedEffortLevels
    const effort = levels && !levels.includes(d.effort) ? undefined : (d.effort as Effort)
    return { model: m, effort, tier: d.tier, difficulty: d.difficulty }
  }
  // Live preview of where the current draft would route (header chip). Only
  // meaningful in cost-saver mode; classifyDifficulty is a cheap regex.
  const routePreview = costSaver ? routeCostSaver(prompt) : null

  async function send(textArg?: string): Promise<void> {
    const text = (textArg ?? prompt).trim()
    if (handleClientCommand(text)) return
    const atts = textArg ? [] : attachments // a retry does not re-attach images
    if ((!text && atts.length === 0) || running) return
    const id = crypto.randomUUID()
    runIdRef.current = id
    ownedRef.current.add(id)
    // Drop stale transient reliability notes on a new send (keep account rate-limit).
    setReliability((r) => (r?.rate ? { rate: r.rate } : null))
    const previews = atts.map((a) => a.preview)
    setTurns((prev) => [
      ...prev,
      { id, prompt: text || '(image)', previews, blocks: [], meta: null, running: true }
    ])
    setHistIndex(null)
    if (!textArg) {
      setPrompt('')
      setAttachments([])
    }
    if (text) {
      const h = promptHistRef.current
      if (h[h.length - 1] !== text) {
        h.push(text)
        if (h.length > 100) h.shift()
        try {
          localStorage.setItem('forge-prompt-history', JSON.stringify(h))
        } catch {
          /* ignore */
        }
      }
    }
    // In cost-saver mode the per-prompt router decides model + effort; otherwise
    // use the manually selected model/effort unchanged.
    let runModel = model
    let runEffort = effort
    if (costSaver) {
      const r = routeCostSaver(text)
      runModel = r.model
      runEffort = r.effort
    }
    const opts: RunOptions = { permission }
    if (runEffort) opts.effort = runEffort
    if (runModel && runModel !== 'default') opts.model = runModel
    if (workspaceId) opts.workspaceId = workspaceId
    // Per-conversation persona override (set via /persona) — a stable systemPrompt
    // for THIS conversation, so it doesn't bust the cache (constant across turns)
    // and overrides the global persona resolved in the main process.
    if (convPersona && convPersona.trim()) opts.systemPrompt = convPersona
    if (sessionIdRef.current) opts.resume = sessionIdRef.current
    if (atts.length) {
      opts.attachments = atts.map((a) => ({ mediaType: a.mediaType, base64: a.base64 }))
    }
    // Per-model turn cap: resolve against the model actually running (cost-saver
    // may route to a different tier than the selected one).
    const turnCap = resolveMaxTurns(maxTurnsByModel, runModel || model || 'default')
    if (turnCap > 0) opts.maxTurns = turnCap
    if (maxBudget > 0) opts.maxBudgetUsd = maxBudget
    // Native magic-keyword trigger: ralph/ultrathink/code-review/… typed in the
    // prompt activate a mode for THIS run — an extra directive (+ optional tier).
    let directive = ''
    let keywordTier: string | undefined
    try {
      const modes = await window.forge.orchestrate.detectKeywords(text)
      const active = modes.filter((m) => m.action !== 'cancel')
      directive = active
        .map((m) => m.systemAppend)
        .filter((s): s is string => !!s)
        .join('\n\n')
      keywordTier = active.find((m) => m.tier)?.tier
    } catch {
      /* keyword detection is best-effort; a normal run still proceeds */
    }
    // In /goal mode every run carries the goal completion protocol so the agent
    // emits GOAL_ACHIEVED / GOAL_CONTINUE the loop reads to decide whether to stop.
    if (goalRef.current) {
      const gd = goalDirective(goalRef.current.objective)
      directive = directive ? `${directive}\n\n${gd}` : gd
    }
    if (keywordTier && !opts.model) opts.model = keywordTier
    // PROMPT-CACHE: inject per-turn directives into the USER MESSAGE rather than
    // mutating opts.systemPrompt. The system prompt (+ tool defs) is the cacheable
    // prefix; changing it per turn (keywords fire on some turns, not others) busts
    // the cache and re-bills the whole prefix. As a user-message prefix the
    // directive lands *after* the stable prefix — cache stays warm — and still
    // reliably reaches the model on resumed turns. (persona stays on systemPrompt,
    // resolved in runStreaming; it's global/stable so it doesn't bust the cache.)
    const promptToSend = directive ? `[Forge mode]\n${directive}\n\n---\n\n${text}` : text
    try {
      await window.forge.agent.start(id, promptToSend, opts)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, running: false, meta: { error: msg } } : t))
      )
    }
  }

  async function stop(): Promise<void> {
    setGoal(null) // a manual STOP also ends any running goal loop
    if (runIdRef.current) await window.forge.agent.interrupt(runIdRef.current)
  }

  /** Enter /goal mode and kick off the first run. */
  function startGoal(objective: string, max: number): void {
    // Cumulative budget: the user's "max $/run" if set (treated as the goal total),
    // else a conservative default. This is the dollar runaway guard.
    const budget = Math.max(GOAL_MAX_USD, maxBudget)
    setGoal({ objective, iter: 1, max, spent: 0, budget })
    processedTurnRef.current = null
    pushNotice(
      '🎯 /goal',
      `Goal set — running autonomously until complete (max ${max} iteration${max === 1 ? '' : 's'} · budget $${budget.toFixed(0)}).\n\nObjective: ${objective}`
    )
    void send(objective)
  }

  function stopGoal(): void {
    const g = goalRef.current
    setGoal(null)
    if (runIdRef.current) void window.forge.agent.interrupt(runIdRef.current)
    if (g) pushNotice('🎯 /goal', `Goal stopped after ${g.iter} iteration${g.iter === 1 ? '' : 's'}.`)
  }

  // Drive the /goal loop: when a goal run finishes, read the assistant's status
  // token and either stop (achieved / error / cap) or auto-send a continuation
  // that resumes the same session (so context + progress carry over).
  useEffect(() => {
    const g = goalRef.current
    if (!g || running) return
    const last = turns[turns.length - 1]
    if (!last || last.running) return
    if (processedTurnRef.current === last.id) return
    processedTurnRef.current = last.id

    // Accumulate the cost of the run that just finished (runaway-budget guard).
    const spent = g.spent + (last.meta?.costUsd ?? 0)

    if (last.meta?.error) {
      setGoal(null)
      pushNotice('🎯 /goal', `Goal stopped — the last run errored: ${last.meta.error}`)
      return
    }
    const answer = last.blocks
      .filter((b): b is Extract<typeof b, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n')
    if (goalAchieved(answer)) {
      setGoal(null)
      pushNotice(
        '🎯 /goal',
        `✓ Goal achieved in ${g.iter} iteration${g.iter === 1 ? '' : 's'} ($${spent.toFixed(2)}).`
      )
      return
    }
    if (spent >= g.budget) {
      setGoal(null)
      pushNotice(
        '🎯 /goal',
        `Reached the $${g.budget.toFixed(0)} budget ($${spent.toFixed(2)} spent) without GOAL_ACHIEVED. Stopping — raise "max $/run" in LIMITS and run /goal again to continue.`
      )
      return
    }
    if (g.iter >= g.max) {
      setGoal(null)
      pushNotice(
        '🎯 /goal',
        `Reached the ${g.max}-iteration cap ($${spent.toFixed(2)} spent) without GOAL_ACHIEVED. Stopping — run /goal again to keep going.`
      )
      return
    }
    setGoal({ ...g, iter: g.iter + 1, spent })
    void send(
      'Continue working toward the goal. Make concrete progress, verify it, and remember to end with GOAL_ACHIEVED or GOAL_CONTINUE on its own line.'
    )
    // send / setGoal / pushNotice are stable enough for this effect; re-running it
    // only when the transcript or running flag changes is exactly what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, running])

  async function compact(): Promise<void> {
    const sid = sessionIdRef.current
    if (!sid || compacting || running) return
    setCompacting(true)
    setCompactPct(0)
    try {
      const r = await window.forge.agent.compact(sid)
      if (r.ok) {
        onSessionRef.current(r.sessionId)
        pushNotice('⟲ /compact', '✓ Context compacted — older messages summarized.')
        setContextTokens(0)
      } else {
        pushNotice('⟲ /compact', `Compact failed${r.error ? ': ' + r.error : ''}`)
      }
    } finally {
      setCompacting(false)
      // Brief settle so the bar visibly reaches 100% before it disappears.
      setTimeout(() => setCompactPct(0), 600)
    }
  }

  /** Download the current conversation (restored history + live turns) as md/json. */
  function doExport(fmt: 'md' | 'json'): void {
    setExportOpen(false)
    const data = { history, turns }
    const text = fmt === 'md' ? conversationToMarkdown(data) : conversationToJson(data)
    const blob = new Blob([text], {
      type: fmt === 'md' ? 'text/markdown' : 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    a.href = url
    a.download = `forge-conversation-${stamp}.${fmt}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /** Show a local system note as a finished turn (no SDK call). */
  function pushNotice(cmd: string, msg: string): void {
    const id = crypto.randomUUID()
    setTurns((prev) => [
      ...prev,
      { id, prompt: cmd, previews: [], blocks: [{ kind: 'text', id: id + '-t', text: msg }], meta: null, running: false }
    ])
  }

  /**
   * Handle GUI-side slash commands that the headless SDK can't run
   * (/model, /effort, /permission, /clear, /help). Returns true if consumed.
   */
  function handleClientCommand(raw: string): boolean {
    const m = raw.match(/^\/(\S+)\s*(.*)$/)
    if (!m) return false
    const cmd = m[1].toLowerCase()
    const arg = m[2].trim()
    if (cmd === 'clear' || cmd === 'new') {
      onNewSession()
      setPrompt('')
      return true
    }
    if (cmd === 'help') {
      setShowHelp(true)
      setPrompt('')
      return true
    }
    if (cmd === 'model') {
      if (!arg) {
        pushNotice(
          raw,
          `Sets the model for THIS conversation. Models: ${models
            .map((x) => x.value)
            .join(', ')} — or any model ID (e.g. /model claude-opus-4-6), or /model global to use the sidebar default.`
        )
        setPrompt('')
        return true
      }
      const a = arg.toLowerCase()
      const found = models.find(
        (x) => x.value.toLowerCase() === a || x.displayName.toLowerCase().includes(a)
      )
      // Accept arbitrary model IDs (like the CLI). Resolve known aliases for a
      // friendlier label; otherwise pass the raw id straight to the SDK.
      const value = found ? found.value : arg
      onSetModel(value)
      pushNotice(
        raw,
        found ? `✓ Model → ${found.displayName} (${found.value})` : `✓ Model → ${value} (custom id)`
      )
      setPrompt('')
      return true
    }
    if (cmd === 'effort') {
      const lvl = arg.toUpperCase()
      if (['AUTO', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'].includes(lvl)) {
        onSetEffort(lvl as EffortLabel)
        pushNotice(raw, `✓ Effort → ${lvl}`)
      } else {
        pushNotice(raw, 'Effort: auto, low, medium, high, xhigh, max')
      }
      setPrompt('')
      return true
    }
    if (cmd === 'permission' || cmd === 'perm') {
      const map: Record<string, Permission> = {
        plan: 'plan',
        ask: 'ask',
        'auto-edit': 'acceptEdits',
        autoedit: 'acceptEdits',
        yolo: 'bypassPermissions'
      }
      const p = map[arg.toLowerCase()]
      if (p) {
        onSetPermission(p)
        pushNotice(raw, `✓ Permission → ${arg.toLowerCase()}`)
      } else {
        pushNotice(raw, 'Permission: plan, ask, auto-edit, yolo')
      }
      setPrompt('')
      return true
    }
    // /persona — set THIS conversation's persona (overrides the global agent for
    // this chat only). Stored on the tab; sent as a stable systemPrompt.
    if (cmd === 'persona') {
      const a = arg.toLowerCase()
      if (!arg) {
        pushNotice(
          raw,
          convPersona
            ? `This conversation's persona:\n\n${convPersona}\n\nType /persona clear to remove it.`
            : 'No conversation persona set. /persona <instructions> gives THIS chat a custom persona (overrides the global agent); /persona clear removes it.'
        )
      } else if (a === 'clear' || a === 'off' || a === 'none') {
        onSetConvPersona(null)
        pushNotice(raw, '✓ Conversation persona cleared — using the global agent.')
      } else {
        onSetConvPersona(arg)
        pushNotice(raw, `✓ Conversation persona set for this chat:\n\n${arg}`)
      }
      setPrompt('')
      return true
    }
    // /goal <objective> — Forge's headless analog of the interactive Claude Code
    // /goal: loop the resumed session until the agent reports GOAL_ACHIEVED.
    if (cmd === 'goal') {
      if (running) {
        pushNotice(raw, 'Finish or stop the current run before starting a goal.')
        setPrompt('')
        return true
      }
      if (!arg) {
        pushNotice(
          raw,
          'Usage: /goal [maxIterations] <objective> — runs autonomously until the' +
            ' objective is met (or the cap). Example: /goal 15 add a dark-mode toggle with tests.'
        )
        setPrompt('')
        return true
      }
      let max = 25
      let objective = arg
      const mm = arg.match(/^(\d{1,3})\s+([\s\S]+)$/)
      if (mm) {
        max = Math.min(100, Math.max(1, Number(mm[1])))
        objective = mm[2].trim()
      }
      setPrompt('')
      startGoal(objective, max)
      return true
    }
    // Interactive-only CLI commands: tell the user instead of silently no-op'ing.
    if (INTERACTIVE_ONLY.has(cmd)) {
      pushNotice(
        raw,
        `/${cmd} is an interactive CLI command and isn't available in Forge's GUI.`
      )
      setPrompt('')
      return true
    }
    // Unknown slash command: if it's not a real SDK/skill command either, don't
    // silently forward it to the model as literal "/foo" text (which only
    // confuses it). Tell the user — the same way the CLI rejects unknown commands.
    const known = new Set(
      [
        ...CLIENT_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]),
        ...commands.flatMap((c) => [c.name, ...(c.aliases ?? [])])
      ].map((s) => s.toLowerCase())
    )
    if (!known.has(cmd)) {
      pushNotice(
        raw,
        `Unknown command /${cmd}. Type “/” to browse available commands, or remove the leading “/” to send this as a normal message.`
      )
      setPrompt('')
      return true
    }
    return false
  }

  // Live magic-keyword detection on the draft → mode chips (debounced).
  useEffect(() => {
    const text = prompt.trim()
    if (!text) {
      setDetectedModes([])
      return
    }
    const t = setTimeout(() => {
      window.forge.orchestrate
        .detectKeywords(text)
        .then((m) => setDetectedModes(m.filter((x) => x.action !== 'cancel')))
        .catch(() => setDetectedModes([]))
    }, 250)
    return () => clearTimeout(t)
  }, [prompt])

  // Cmd/Ctrl+F toggles the transcript search box (Escape closes it). Only the
  // visible tab responds — every tab's Composer is mounted, so without this gate
  // one Cmd+F would toggle search in all of them at once (H2).
  useEffect(() => {
    if (!isActive) return
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        requestAnimationFrame(() => searchRef.current?.focus())
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        setSearch('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen, isActive])

  function onDrop(e: RDragEvent): void {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
  }

  function addFiles(files: FileList | null): void {
    if (!files) return
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result)
        const base64 = dataUrl.split(',')[1] ?? ''
        setAttachments((prev) => [
          ...prev,
          { id: crypto.randomUUID(), mediaType: file.type, base64, preview: dataUrl, name: file.name }
        ])
      }
      reader.readAsDataURL(file)
    }
  }

  // Slash-command autocomplete: active while typing "/name" (before any space).
  const slashQuery =
    prompt.startsWith('/') && !prompt.includes(' ') ? prompt.slice(1).toLowerCase() : null
  // Memoized so it isn't recomputed on every streaming flush; slashQuery is null
  // unless the prompt starts with "/", so the filter only runs while typing a
  // command. docs/PERFORMANCE.md lever 7.
  const matches = useMemo<SlashCommand[]>(
    () =>
      slashQuery !== null && !dismissed
        ? [...CLIENT_COMMANDS, ...commands]
            .filter(
              (c) =>
                c.name.toLowerCase().startsWith(slashQuery) ||
                (c.aliases ?? []).some((a) => a.toLowerCase().startsWith(slashQuery))
            )
            .slice(0, 8)
        : [],
    [slashQuery, dismissed, commands]
  )
  const menuOpen = matches.length > 0
  const menuSel = Math.min(menuIndex, matches.length - 1)

  function acceptCommand(cmd: SlashCommand): void {
    setPrompt('/' + cmd.name + ' ')
    setDismissed(false)
    setMenuIndex(0)
    taRef.current?.focus()
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMenuIndex((i) => (i + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMenuIndex((i) => (i - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        acceptCommand(matches[menuSel])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return
      }
    }
    // Prompt history recall (slash menu closed, caret at the very start).
    const ta = e.currentTarget
    if (e.key === 'ArrowUp' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      const h = promptHistRef.current
      if (h.length) {
        e.preventDefault()
        const idx = histIndex === null ? h.length - 1 : Math.max(0, histIndex - 1)
        setHistIndex(idx)
        setPrompt(h[idx])
        return
      }
    }
    if (e.key === 'ArrowDown' && histIndex !== null) {
      e.preventDefault()
      const h = promptHistRef.current
      const idx = histIndex + 1
      if (idx >= h.length) {
        setHistIndex(null)
        setPrompt('')
      } else {
        setHistIndex(idx)
        setPrompt(h[idx])
      }
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const idle = turns.length === 0
  const ctxPct =
    contextTokens > 0
      ? Math.min(100, Math.round((contextTokens / ctxWindow(contextModel)) * 100))
      : 0

  const q = search.trim().toLowerCase()
  const shownTurns = q ? turns.filter((t) => turnText(t).includes(q)) : turns

  return (
    <div
      className={`work${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault()
          if (!dragOver) setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <span className="drop-icon">⌬</span> drop images to attach
          </div>
        </div>
      )}
      <div className="work-header">
        <div className="wh-left">
          <span className="wh-item">
            <span className="brand-mark">⚒</span> {costSaver ? 'cost-saver' : model ?? 'default'}
          </span>
          <span className="wh-sep">·</span>
          <span className="wh-item">{permission}</span>
          <span className="wh-sep">·</span>
          <span className="wh-item">effort {costSaver ? 'auto' : effort ?? 'auto'}</span>
          {convPersona && (
            <>
              <span className="wh-sep">·</span>
              <span className="wh-item route-preview" title={convPersona}>
                ✦ persona
              </span>
            </>
          )}
          {routePreview && prompt.trim() && (
            <>
              <span className="wh-sep">·</span>
              <span
                className="wh-item route-preview"
                title="Cost-saver routes this task to the cheapest tier that fits its difficulty"
              >
                → {routePreview.model} ({routePreview.difficulty})
              </span>
            </>
          )}
        </div>
        <div className="wh-right">
          {(turns.length > 0 || history.length > 0) && (
            <div className="export-wrap">
              <button
                className={`mini-btn${exportOpen ? ' on' : ''}`}
                title="Export this conversation"
                onClick={() => setExportOpen((v) => !v)}
              >
                ⭳ export
              </button>
              {exportOpen && (
                <div className="export-menu" onMouseLeave={() => setExportOpen(false)}>
                  <button className="export-item" onClick={() => doExport('md')}>
                    Markdown (.md)
                  </button>
                  <button className="export-item" onClick={() => doExport('json')}>
                    JSON (.json)
                  </button>
                </div>
              )}
            </div>
          )}
          {turns.length > 0 && (
            <button
              className={`mini-btn${searchOpen ? ' on' : ''}`}
              title="Search this conversation (Ctrl/Cmd+F)"
              onClick={() => {
                const next = !searchOpen
                setSearchOpen(next)
                if (next) requestAnimationFrame(() => searchRef.current?.focus())
                else setSearch('')
              }}
            >
              ⌕ find
            </button>
          )}
          {contextTokens > 0 && (
            <div
              className={`ctx-gauge ${ctxPct >= 70 ? 'hot' : ''}`}
              title={`${contextTokens.toLocaleString()} context tokens of ${ctxWindow(contextModel).toLocaleString()}`}
            >
              ctx {ctxPct}%
              <div className="ctx-bar">
                <div className="ctx-fill" style={{ width: ctxPct + '%' }} />
              </div>
            </div>
          )}
          {compacting || compactPct > 0 ? (
            <div
              className="compact-progress"
              title={`Compacting context… ${compactPct}%`}
              role="progressbar"
              aria-valuenow={compactPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span className="compact-progress-label">⟲ compacting… {compactPct}%</span>
              <div className="compact-bar">
                <div className="compact-fill" style={{ width: compactPct + '%' }} />
              </div>
            </div>
          ) : (
            sessionId && (
              <button
                className="mini-btn"
                onClick={compact}
                disabled={running}
                title="Summarize older context to free tokens"
              >
                ⟲ compact
              </button>
            )
          )}
        </div>
      </div>
      {running &&
        (() => {
          const act = activityLabel(activeTurn)
          return (
            <div className="live-strip" title="What the agent is doing right now">
              <span className="ls-spinner" aria-hidden />
              <span className="ls-icon">{act.icon}</span>
              <span className="ls-text">{act.text}</span>
              <Elapsed className="ls-elapsed" />
            </div>
          )
        })()}
      {reliability && (reliability.retry || reliability.rate || reliability.compact) && (
        <div className="reliability">
          {reliability.retry && (
            <div className="rb-item retry">
              <span className="rb-spin" aria-hidden /> Retrying
              {reliability.retry.status ? ` (${reliability.retry.status})` : ''} — attempt{' '}
              {reliability.retry.attempt}/{reliability.retry.max}…
            </div>
          )}
          {reliability.rate && (
            <div className={`rb-item rate ${reliability.rate.status}`}>
              ⚠ Rate limit{reliability.rate.rateLimitType ? ` (${reliability.rate.rateLimitType})` : ''}
              {typeof reliability.rate.utilization === 'number'
                ? ` — ${Math.round(reliability.rate.utilization * 100)}% used`
                : ''}
              {reliability.rate.resetsAt
                ? ` · resets ${new Date(
                    reliability.rate.resetsAt > 1e12
                      ? reliability.rate.resetsAt
                      : reliability.rate.resetsAt * 1000
                  ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : ''}
            </div>
          )}
          {reliability.compact && (
            <div className="rb-item compact">
              ✦ Context {reliability.compact.trigger === 'auto' ? 'auto-' : ''}compacted
              {reliability.compact.pre
                ? ` — ${Math.round(reliability.compact.pre / 1000)}k→${
                    reliability.compact.post ? Math.round(reliability.compact.post / 1000) + 'k' : '…'
                  } tokens`
                : ''}
              <button
                className="rb-x"
                title="Dismiss"
                onClick={() => setReliability((r) => (r ? { ...r, compact: undefined } : r))}
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}
      {searchOpen && (
        <div className="transcript-search">
          <span className="ts-icon">⌕</span>
          <input
            ref={searchRef}
            className="ts-input"
            value={search}
            placeholder="Search this conversation…"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchOpen(false)
                setSearch('')
              }
            }}
          />
          {q && (
            <span className="ts-count">
              {shownTurns.length} / {turns.length}
            </span>
          )}
          <button
            className="ts-close"
            title="Close (Esc)"
            onClick={() => {
              setSearchOpen(false)
              setSearch('')
            }}
          >
            ✕
          </button>
        </div>
      )}
      <div className="transcript" ref={transcriptRef}>
        {!q && <HistoryView items={history} />}

        {idle && history.length === 0 && !q && (
          <div className="anvil">
            <div className="anvil-mark">⚒</div>
            <div className="anvil-text">The anvil is ready. Describe the work.</div>
          </div>
        )}

        {q && shownTurns.length === 0 && (
          <div className="anvil">
            <div className="anvil-text">No turns match “{search.trim()}”.</div>
          </div>
        )}

        {shownTurns.map((t) => (
          <TurnView key={t.id} turn={t} onRetry={handleRetry} onEdit={handleEdit} />
        ))}
      </div>

      {menuOpen && (
        <div className="slash-menu">
          {matches.map((c, i) => (
            <button
              key={c.name}
              className={`slash-item ${i === menuSel ? 'on' : ''}`}
              onMouseEnter={() => setMenuIndex(i)}
              onClick={() => acceptCommand(c)}
            >
              <span className="slash-name">
                /{c.name}
                {c.argumentHint ? <span className="slash-hint"> {c.argumentHint}</span> : null}
              </span>
              {c.description && <span className="slash-desc">{c.description}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="composer-wrap">
        {goal && (
          <div className="goal-banner" title="Autonomous goal loop — runs until the objective verifies">
            <span className="goal-spinner" aria-hidden />
            <span className="goal-mark">🎯</span>
            <span className="goal-label">GOAL</span>
            <span className="goal-obj">{goal.objective}</span>
            <span className="goal-iter">
              iter {goal.iter}/{goal.max} · ${goal.spent.toFixed(2)}/${goal.budget.toFixed(0)}
            </span>
            <button className="goal-stop" onClick={stopGoal} title="Stop the goal loop">
              ■ stop goal
            </button>
          </div>
        )}
        {!running && detectedModes.length > 0 && (
          <div className="mode-chips" title="Magic-keyword modes detected in your message — they activate on send">
            {detectedModes.map((m) => (
              <span className={`mode-chip ${m.action}`} key={m.name}>
                <span className="mode-chip-name">{m.name}</span>
                <span className="mode-chip-act">{m.action}</span>
              </span>
            ))}
          </div>
        )}
        {latestTodos && <TodoBar todos={latestTodos} />}
        {attachments.length > 0 && (
          <div className="attach-row">
            {attachments.map((a) => (
              <div className="attach-thumb" key={a.id} title={a.name}>
                <img src={a.preview} alt={a.name} />
                <button
                  className="attach-x"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer">
          <button
            className="attach-btn"
            title="Attach image"
            onClick={() => fileRef.current?.click()}
          >
            ＋
          </button>
          <span className="composer-prompt" aria-hidden="true">
            ›
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <textarea
            ref={taRef}
            className="composer-input"
            placeholder="Describe the work…  (Enter send · Shift+Enter newline · / commands · ↑ history)"
            rows={3}
            autoFocus
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              setDismissed(false)
              setHistIndex(null)
            }}
            onKeyDown={onKey}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData.items).filter((it) =>
                it.type.startsWith('image/')
              )
              if (imgs.length) {
                e.preventDefault()
                const dt = new DataTransfer()
                imgs.forEach((it) => {
                  const f = it.getAsFile()
                  if (f) dt.items.add(f)
                })
                addFiles(dt.files)
              }
            }}
          />
          <div className="send-col">
            <button
              className={`scroll-toggle ${stickBottom ? 'on' : ''}`}
              title={
                stickBottom
                  ? 'Auto-scroll: following latest line (click to stop at answers)'
                  : 'Auto-scroll: stops at answers (click to follow latest)'
              }
              onClick={() => setStickBottom((v) => !v)}
            >
              {stickBottom ? '⤓ Follow' : '⤒ Manual'}
            </button>
            {running ? (
              <button className="stop" onClick={stop}>
                ■ STOP
              </button>
            ) : (
              <button
                className="primary send"
                disabled={!prompt.trim() && attachments.length === 0}
                onClick={() => send()}
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>

      {perms[0] && (
        <PermissionModal
          req={perms[0]}
          onResolve={(allow) => {
            const id = perms[0].id
            window.forge.agent.respondPermission(id, allow)
            setPerms((prev) => prev.slice(1))
          }}
        />
      )}

      {dialogs[0]?.dialogKind === 'permission_ask_user_question' && (
        <QuestionModal
          req={dialogs[0]}
          onSubmit={(result) => {
            window.forge.agent.respondDialog(dialogs[0].id, result)
            setDialogs((prev) => prev.slice(1))
          }}
          onCancel={() => {
            window.forge.agent.respondDialog(dialogs[0].id, {
              behavior: 'deny',
              message: 'User dismissed the question'
            })
            setDialogs((prev) => prev.slice(1))
          }}
        />
      )}

      {showHelp && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">COMMANDS</div>
            <div className="help-note">Handled by Forge (GUI):</div>
            {CLIENT_COMMANDS.map((c) => (
              <div className="help-row" key={c.name}>
                <span className="slash-name">
                  /{c.name}
                  {c.argumentHint ? ' ' + c.argumentHint : ''}
                </span>
                <span className="help-desc">{c.description}</span>
              </div>
            ))}
            <div className="help-note">
              <b>/goal</b> runs autonomously: it loops the conversation, resuming the session each
              turn until the agent reports the objective complete (or the iteration cap). A banner
              over the composer shows progress — stop it any time.
            </div>
            <div className="help-note">
              Plus Claude commands (/usage, /cost, /compact…) and your skills — type / to browse.
              Interactive-only commands like /login or /agents aren't available in this environment.
            </div>
            <div className="modal-actions">
              <button className="primary" onClick={() => setShowHelp(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
