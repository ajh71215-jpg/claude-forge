// Client-side slash-command dispatcher, extracted from Composer.tsx (behavior-
// preserving). These are the commands the headless SDK can't run (handled in the
// GUI): /clear /help /model /effort /permission /persona /goal, plus the unknown-
// command + interactive-only feedback. Pure — all side effects go through ctx.
import { CLIENT_COMMANDS } from './constants'
import { INTERACTIVE_ONLY } from './composer'
import type { EffortLabel, ModelInfo, Permission, SlashCommand } from '../types'

export interface SlashCommandContext {
  models: ModelInfo[]
  /** SDK/skill commands (so unknown-command detection knows what's real). */
  commands: SlashCommand[]
  /** This conversation's persona override (for /persona display). */
  convPersona?: string
  running: boolean
  setPrompt: (s: string) => void
  pushNotice: (cmd: string, msg: string) => void
  onNewSession: () => void
  showHelp: () => void
  onSetModel: (v: string) => void
  onSetEffort: (l: EffortLabel) => void
  onSetPermission: (p: Permission) => void
  onSetConvPersona: (text: string | null) => void
  startGoal: (objective: string, max: number) => void
}

/** Handle a GUI-side slash command. Returns true if consumed (don't send to SDK). */
export function handleSlashCommand(raw: string, ctx: SlashCommandContext): boolean {
  const m = raw.match(/^\/(\S+)\s*(.*)$/)
  if (!m) return false
  const cmd = m[1].toLowerCase()
  const arg = m[2].trim()
  const { setPrompt, pushNotice } = ctx

  if (cmd === 'clear' || cmd === 'new') {
    ctx.onNewSession()
    setPrompt('')
    return true
  }
  if (cmd === 'help') {
    ctx.showHelp()
    setPrompt('')
    return true
  }
  if (cmd === 'model') {
    if (!arg) {
      pushNotice(
        raw,
        `Sets the model for THIS conversation. Models: ${ctx.models
          .map((x) => x.value)
          .join(', ')} — or any model ID (e.g. /model claude-opus-4-6), or /model global to use the sidebar default.`
      )
      setPrompt('')
      return true
    }
    const a = arg.toLowerCase()
    const found = ctx.models.find(
      (x) => x.value.toLowerCase() === a || x.displayName.toLowerCase().includes(a)
    )
    // Accept arbitrary model IDs (like the CLI). Resolve known aliases for a
    // friendlier label; otherwise pass the raw id straight to the SDK.
    const value = found ? found.value : arg
    ctx.onSetModel(value)
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
      ctx.onSetEffort(lvl as EffortLabel)
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
      ctx.onSetPermission(p)
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
        ctx.convPersona
          ? `This conversation's persona:\n\n${ctx.convPersona}\n\nType /persona clear to remove it.`
          : 'No conversation persona set. /persona <instructions> gives THIS chat a custom persona (overrides the global agent); /persona clear removes it.'
      )
    } else if (a === 'clear' || a === 'off' || a === 'none') {
      ctx.onSetConvPersona(null)
      pushNotice(raw, '✓ Conversation persona cleared — using the global agent.')
    } else {
      ctx.onSetConvPersona(arg)
      pushNotice(raw, `✓ Conversation persona set for this chat:\n\n${arg}`)
    }
    setPrompt('')
    return true
  }
  // /goal <objective> — Forge's headless analog of the interactive Claude Code
  // /goal: loop the resumed session until the agent reports GOAL_ACHIEVED.
  if (cmd === 'goal') {
    if (ctx.running) {
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
    ctx.startGoal(objective, max)
    return true
  }
  // Interactive-only CLI commands: tell the user instead of silently no-op'ing.
  if (INTERACTIVE_ONLY.has(cmd)) {
    pushNotice(raw, `/${cmd} is an interactive CLI command and isn't available in Forge's GUI.`)
    setPrompt('')
    return true
  }
  // Unknown slash command: if it's not a real SDK/skill command either, don't
  // silently forward it to the model as literal "/foo" text (which only confuses
  // it). Tell the user — the same way the CLI rejects unknown commands.
  const known = new Set(
    [
      ...CLIENT_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]),
      ...ctx.commands.flatMap((c) => [c.name, ...(c.aliases ?? [])])
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
