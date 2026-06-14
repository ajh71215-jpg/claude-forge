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
import { ctxWindow } from '../../lib/format'
// Shared model router (docs/TOKEN_OPTIMIZATION.md §3 lever 4 ∩ SQUAD §4): the
// cost-saver classifies each prompt's difficulty and routes to the cheapest tier
// that fits, instead of a flat "always Sonnet". Single owner — the conductor's
// cascade imports the same module, so the policy is never duplicated.
import { route, resolveModelId } from '../../../../main/routing'
import { deriveTasks, parseTodos } from '../../lib/blocks'
import { useAgentEvents } from './useAgentEvents'
import HistoryView from './HistoryView'
import TurnView from './TurnView'
import TodoBar from './TodoBar'
import PermissionModal from './PermissionModal'
import QuestionModal from './QuestionModal'

export default function Composer({
  model,
  permission,
  effort,
  commands,
  models,
  maxTurns,
  maxBudget,
  autoCompact,
  costSaver,
  onResult,
  sessionId,
  sessionKey,
  onSession,
  onSetModel,
  onSetEffort,
  onSetPermission,
  onNewSession
}: {
  model?: string
  permission: Permission
  effort?: Effort
  commands: SlashCommand[]
  models: ModelInfo[]
  maxTurns: number
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
  onSetModel: (value: string) => void
  onSetEffort: (label: EffortLabel) => void
  onSetPermission: (p: Permission) => void
  onNewSession: () => void
}): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [menuIndex, setMenuIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [history, setHistory] = useState<TranscriptItem[]>([])
  const [attachments, setAttachments] = useState<
    { id: string; mediaType: string; base64: string; preview: string; name: string }[]
  >([])
  const [histIndex, setHistIndex] = useState<number | null>(null)
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
    setContextModel
  } = useAgentEvents({ ownedRef, runIdRef, onSessionRef, onResultRef, taRef })

  // Keep the transcript pinned to the bottom as content streams in — but only
  // when the user is already near the bottom (don't yank them down if they
  // scrolled up to read), and via rAF so scrollTop is written at most once per
  // frame instead of forcing a layout on every delta. docs/PERFORMANCE.md lever 4.
  useEffect(() => {
    const el = transcriptRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (!nearBottom) return
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(id)
  }, [turns])

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
    if (sessionIdRef.current) opts.resume = sessionIdRef.current
    if (atts.length) {
      opts.attachments = atts.map((a) => ({ mediaType: a.mediaType, base64: a.base64 }))
    }
    if (maxTurns > 0) opts.maxTurns = maxTurns
    if (maxBudget > 0) opts.maxBudgetUsd = maxBudget
    try {
      await window.forge.agent.start(id, text, opts)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, running: false, meta: { error: msg } } : t))
      )
    }
  }

  async function stop(): Promise<void> {
    if (runIdRef.current) await window.forge.agent.interrupt(runIdRef.current)
  }

  async function compact(): Promise<void> {
    const sid = sessionIdRef.current
    if (!sid || compacting || running) return
    setCompacting(true)
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
    }
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
          `Models: ${models.map((x) => x.value).join(', ')} — or any model ID, e.g. /model claude-opus-4-6`
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
    return false
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

  return (
    <div className="work">
      <div className="work-header">
        <div className="wh-left">
          <span className="wh-item">
            <span className="brand-mark">⚒</span> {costSaver ? 'cost-saver' : model ?? 'default'}
          </span>
          <span className="wh-sep">·</span>
          <span className="wh-item">{permission}</span>
          <span className="wh-sep">·</span>
          <span className="wh-item">effort {costSaver ? 'auto' : effort ?? 'auto'}</span>
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
          {sessionId && (
            <button
              className="mini-btn"
              onClick={compact}
              disabled={compacting || running}
              title="Summarize older context to free tokens"
            >
              {compacting ? 'compacting…' : '⟲ compact'}
            </button>
          )}
        </div>
      </div>
      <div className="transcript" ref={transcriptRef}>
        <HistoryView items={history} />

        {idle && history.length === 0 && (
          <div className="anvil">
            <div className="anvil-mark">⚒</div>
            <div className="anvil-text">The anvil is ready. Describe the work.</div>
          </div>
        )}

        {turns.map((t) => (
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
