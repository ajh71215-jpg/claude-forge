import { readSettings, writeSettings } from './projectSettings'

/**
 * Hooks (roadmap #2) — the portable, Claude-Code-standard track: shell-command
 * hooks persisted to `.claude/settings.json`. Because settingSources includes
 * 'project', the SDK loads and fires them on every run with no extra wiring.
 *
 * The file format nests hooks by event then matcher-group:
 *   { hooks: { PreToolUse: [ { matcher: "Bash", hooks: [ {type:"command", command} ] } ] } }
 * Forge presents a FLAT list of rules (one event + matcher + command each) and
 * round-trips to the nested shape, touching only the `hooks` key so any other
 * settings the user has are preserved.
 */

export interface HookRule {
  /** Stable id for the UI; not persisted. */
  id: string
  event: string
  /** Tool/name pattern; '' means "all" (no matcher key written). */
  matcher: string
  command: string
  timeout?: number
}

type CommandHook = { type: 'command'; command: string; timeout?: number }
type MatcherGroup = { matcher?: string; hooks: CommandHook[] }

export async function listHooks(): Promise<HookRule[]> {
  const settings = await readSettings()
  const hooks = settings.hooks as Record<string, MatcherGroup[]> | undefined
  if (!hooks || typeof hooks !== 'object') return []
  const rules: HookRule[] = []
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    groups.forEach((g, gi) => {
      const matcher = typeof g?.matcher === 'string' ? g.matcher : ''
      const list = Array.isArray(g?.hooks) ? g.hooks : []
      list.forEach((h, hi) => {
        if (h?.type === 'command' && typeof h.command === 'string') {
          rules.push({
            id: `${event}:${gi}:${hi}`,
            event,
            matcher,
            command: h.command,
            timeout: typeof h.timeout === 'number' ? h.timeout : undefined
          })
        }
      })
    })
  }
  return rules
}

/** Replace all command-hooks with `rules`, preserving every other settings key. */
export async function saveHooks(rules: HookRule[]): Promise<HookRule[]> {
  const settings = await readSettings()
  const byEvent: Record<string, MatcherGroup[]> = {}
  for (const r of rules) {
    const event = (r.event || '').trim()
    const command = (r.command || '').trim()
    if (!event || !command) continue
    const matcher = (r.matcher || '').trim()
    const hook: CommandHook = { type: 'command', command }
    if (r.timeout && r.timeout > 0) hook.timeout = r.timeout
    ;(byEvent[event] ??= []).push({ ...(matcher ? { matcher } : {}), hooks: [hook] })
  }
  if (Object.keys(byEvent).length > 0) settings.hooks = byEvent
  else delete settings.hooks
  await writeSettings(settings)
  return listHooks()
}
