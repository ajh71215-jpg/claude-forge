// The CHAT composer + live transcript (docs/MAINTAINABILITY.md Phase 2).
// Extracted verbatim from App.tsx — behavior-preserving. The streaming event
// subscription (rAF-coalesced) and near-bottom autoscroll are docs/PERFORMANCE.md
// levers 2 & 4 — do not change without re-profiling.
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
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
import { ctxWindow, resolveMaxTurns } from '../../lib/format'
// Shared model router (docs/TOKEN_OPTIMIZATION.md §3 lever 4 ∩ SQUAD §4): the
// cost-saver classifies each prompt's difficulty and routes to the cheapest tier
// that fits, instead of a flat "always Sonnet". Single owner — the conductor's
// cascade imports the same module, so the policy is never duplicated.
import { route, resolveModelId } from '../../../../main/routing'
import { deriveTasks, parseTodos } from '../../lib/blocks'
import { conversationToJson, conversationToMarkdown } from '../../lib/export'
import { activityLabel } from '../../lib/composer'
import { goalDirective } from '../../lib/goal'
import { handleSlashCommand } from '../../lib/slashCommands'
import { useAgentEvents } from './useAgentEvents'
import { useImageAttachments } from './useImageAttachments'
import { useTranscriptSearch } from './useTranscriptSearch'
import { useGoalLoop } from './useGoalLoop'
import { useCompaction } from './useCompaction'
import HistoryView from './HistoryView'
import TurnView from './TurnView'
import TodoBar from './TodoBar'
import ChatControls from './ChatControls'
import PermissionModal from './PermissionModal'
import QuestionModal from './QuestionModal'
import ReliabilityBanner from './ReliabilityBanner'
import WorkHeader from './WorkHeader'
import Elapsed from './Elapsed'
import type { KeywordMatch, LazySetting } from '../../types'

export default function Composer({
  model,
  permission,
  effort,
  globalModel,
  tabModel,
  globalEffort,
  tabEffort,
  commands,
  models,
  maxTurnsByModel,
  maxBudget,
  autoCompact,
  costSaver,
  lazyLevel = 'off',
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
  /** The global sidebar model selection (fallback shown in the per-chat control). */
  globalModel: string
  /** This conversation's model override (undefined ⇒ uses the global). */
  tabModel?: string
  /** The global sidebar effort label (fallback shown in the per-chat control). */
  globalEffort: EffortLabel
  /** This conversation's effort override (undefined ⇒ uses the global). */
  tabEffort?: EffortLabel
  commands: SlashCommand[]
  models: ModelInfo[]
  /** Per-model max-turns overrides (model id → turns). Default applied per model. */
  maxTurnsByModel: Record<string, number>
  maxBudget: number
  autoCompact: boolean
  /** Cost-saver mode: route each prompt to a tier by difficulty (lever 4). */
  costSaver: boolean
  /** Persistent lazy mode (ponytail) intensity from Settings; 'off' = inactive.
   * When set, every run carries the leveled lazy directive (cache-stable prefix). */
  lazyLevel?: LazySetting
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
  /** Set this conversation's effort override; 'GLOBAL' reverts to the sidebar. */
  onSetEffort: (label: EffortLabel | 'GLOBAL') => void
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
  const [history, setHistory] = useState<TranscriptItem[]>([])
  // Image attachments (drag-drop / picker / paste) — own hook.
  const { attachments, setAttachments, dragOver, setDragOver, fileRef, addFiles, onDrop } =
    useImageAttachments()
  const [exportOpen, setExportOpen] = useState(false)
  // Magic-keyword modes detected in the current draft (shown as chips so the
  // trigger is discoverable before sending).
  const [detectedModes, setDetectedModes] = useState<KeywordMatch[]>([])
  const [histIndex, setHistIndex] = useState<number | null>(null)
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

  // Transcript search (Cmd/Ctrl+F) — owns its state + the active-tab keydown.
  const searchState = useTranscriptSearch(turns, isActive)
  const { search, setSearch, searchOpen, setSearchOpen, searchRef, q, shownTurns } = searchState

  const running = turns.some((t) => t.running)
  const activeTurn = turns.find((t) => t.running) ?? null

  // The autonomous /goal loop — owns the goal state + the loop driver. send()
  // reads goalRef to prefix the directive; the loop drives send() via sendRef.
  const { goal, goalRef, startGoal, stopGoal, resetGoal } = useGoalLoop({
    turns,
    running,
    runIdRef,
    maxBudget,
    sendRef,
    pushNotice
  })

  // Context compaction: manual /compact + live progress bar + auto-compact at 80%.
  const compaction = useCompaction({
    sessionIdRef,
    onSessionRef,
    pushNotice,
    setContextTokens,
    autoCompact,
    running,
    contextTokens,
    contextModel,
    workspaceId
  })

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
    resetGoal() // switching conversations abandons any in-flight goal loop
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

  // Task progress for the pinned bar above the composer. Models track work via
  // the Task tools (TaskCreate/TaskUpdate/TaskList), so reconstruct from those;
  // fall back to TodoWrite for any agent that still uses it.
  const latestTodos = useMemo<Todo[] | null>(() => {
    const taskTodos = deriveTasks(turns)
    if (taskTodos.length) return taskTodos
    for (let i = turns.length - 1; i >= 0; i--) {
      const blocks = turns[i].blocks
      for (let j = blocks.length - 1; j >= 0; j--) {
        const b = blocks[j]
        if (b.kind === 'tool' && b.name === 'TodoWrite') {
          const todos = parseTodos(b.inputRaw)
          if (todos && todos.length) return todos
        }
      }
    }
    return null
  }, [turns])

  // Cost-saver routing (lever 4): classify the prompt's difficulty and pick the
  // cheapest tier that fits, resolving the tier alias to a concrete model id from
  // the live model list. Effort is dropped for models that report no effort
  // control (e.g. Haiku) — sending an unsupported level would error, mirroring
  // the manual EFFORT guard in App.
  const routeCostSaver = useCallback(
    (text: string): { model: string; effort?: Effort; tier: string; difficulty: string } => {
      const d = route({ instruction: text })
      const m = resolveModelId(d.tier, models)
      const levels = models.find((x) => x.value === m)?.supportedEffortLevels
      const effort = levels && !levels.includes(d.effort) ? undefined : (d.effort as Effort)
      return { model: m, effort, tier: d.tier, difficulty: d.difficulty }
    },
    [models]
  )
  // Live preview of where the current draft would route (header chip). Only
  // meaningful in cost-saver mode; classifyDifficulty is a cheap regex.
  const routePreview = useMemo(
    () => (costSaver ? routeCostSaver(prompt) : null),
    [costSaver, prompt, routeCostSaver]
  )

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
      // When lazy mode is on globally, the persisted level supersedes the
      // ponytail keyword's (always-'full') directive — drop it to avoid injecting
      // the ladder twice; the leveled directive is prepended below.
      const parts = active
        .filter((m) => !(lazyLevel !== 'off' && m.name === 'ponytail'))
        .map((m) => m.systemAppend)
        .filter((s): s is string => !!s)
      if (lazyLevel !== 'off') {
        const lazy = await window.forge.orchestrate.lazyDirective(lazyLevel)
        parts.unshift(lazy)
      }
      directive = parts.join('\n\n')
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
    resetGoal() // a manual STOP also ends any running goal loop
    if (runIdRef.current) await window.forge.agent.interrupt(runIdRef.current)
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

  /** GUI-side slash commands the headless SDK can't run (dispatcher in lib). */
  function handleClientCommand(raw: string): boolean {
    return handleSlashCommand(raw, {
      models,
      commands,
      convPersona,
      running,
      setPrompt,
      pushNotice,
      onNewSession,
      showHelp: () => setShowHelp(true),
      onSetModel,
      onSetEffort,
      onSetPermission,
      onSetConvPersona,
      startGoal
    })
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
      <WorkHeader
        model={model}
        permission={permission}
        effort={effort}
        costSaver={costSaver}
        convPersona={convPersona}
        routePreview={routePreview}
        promptHasText={!!prompt.trim()}
        hasTurns={turns.length > 0}
        hasHistory={history.length > 0}
        exportOpen={exportOpen}
        setExportOpen={setExportOpen}
        doExport={doExport}
        search={searchState}
        contextTokens={contextTokens}
        ctxPct={ctxPct}
        contextModel={contextModel}
        compaction={compaction}
        sessionId={sessionId}
        running={running}
      />
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
      <ReliabilityBanner
        reliability={reliability}
        onDismissCompact={() => setReliability((r) => (r ? { ...r, compact: undefined } : r))}
      />
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
        <ChatControls
          models={models}
          globalModel={globalModel}
          tabModel={tabModel}
          onSetModel={onSetModel}
          globalEffort={globalEffort}
          tabEffort={tabEffort}
          onSetEffort={onSetEffort}
          convPersona={convPersona}
          onSetConvPersona={onSetConvPersona}
          costSaver={costSaver}
        />
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
