// Pet state machine: maps Forge's AgentEvent stream → a pet state → a Clawd svg
// file, and pushes changes to the pet window. Idle/sleep is time-driven; mouse
// movement wakes a sleeping pet. Concurrency (Squad) is reflected by the working
// tier (1 run = typing, 2 = groove, 3+ = building) via theme.workingTiers.
import { screen } from 'electron'
import { readFileSync } from 'fs'
import type { AgentEvent } from '../agent/types'
import { petThemePath } from './paths'
import { sendPetState } from './petWindow'

interface Theme {
  states: Record<string, string[]>
  workingTiers?: { minSessions: number; file: string }[]
  idleAnimations?: { file: string; duration: number }[]
  timings?: {
    yawnDuration?: number
    wakeDuration?: number
    mouseSleepTimeout?: number
    deepSleepTimeout?: number
    minDisplay?: Record<string, number>
  }
}

// Idle → sleep cadence (ms). Defaults overridden by theme.timings when present.
const SLEEP_AFTER = 60_000 // no activity → start yawning
const DOZE_AFTER = 30_000 // dozing → sleeping
const MOUSE_POLL = 1500

// A transient briefly overrides the computed state. `svg` lets a transient carry
// an explicit asset (used by idle micro-animations, which are files not states).
type Transient = { state: string; until: number; svg?: string } | null

let theme: Theme | null = null
let activeRuns = new Set<string>()
let lastActivity: 'thinking' | 'working' = 'thinking'
let transient: Transient = null
let idlePhase: 'idle' | 'yawning' | 'dozing' | 'sleeping' = 'idle'
let displayed = '' // last svg pushed, for dedup

let idleTimer: NodeJS.Timeout | null = null
let transientTimer: NodeJS.Timeout | null = null
let idleAnimTimer: NodeJS.Timeout | null = null
let mousePoll: NodeJS.Timeout | null = null
let lastCursor: { x: number; y: number } | null = null
let running = false

function loadTheme(): Theme {
  if (theme) return theme
  try {
    theme = JSON.parse(readFileSync(petThemePath(), 'utf8')) as Theme
  } catch {
    theme = { states: { idle: ['clawd-idle-follow.svg'] } }
  }
  return theme
}

function svgFor(state: string): string {
  const t = loadTheme()
  if (state === 'working' && t.workingTiers && t.workingTiers.length) {
    const n = Math.max(1, activeRuns.size)
    // tiers are listed high→low; pick the first whose minSessions <= n.
    const tier = t.workingTiers.find((x) => n >= x.minSessions) || t.workingTiers[t.workingTiers.length - 1]
    return tier.file
  }
  const arr = t.states[state]
  if (arr && arr.length) return arr[0]
  return t.states.idle?.[0] || 'clawd-idle-follow.svg'
}

function minDisplay(state: string, fallback: number): number {
  return loadTheme().timings?.minDisplay?.[state] ?? fallback
}

/** Resolve the current target state from priority, then push if it changed. */
function recompute(): void {
  if (!running) return
  let state: string
  let explicitSvg: string | undefined
  if (transient && Date.now() < transient.until) {
    state = transient.state
    explicitSvg = transient.svg
  } else {
    transient = null
    if (activeRuns.size > 0) {
      state = lastActivity === 'working' ? 'working' : 'thinking'
    } else {
      state = idlePhase
    }
  }
  const svg = explicitSvg ?? svgFor(state)
  if (svg !== displayed) {
    displayed = svg
    sendPetState(state, svg)
  }
}

function setTransient(state: string, ms: number, svg?: string): void {
  transient = { state, until: Date.now() + ms, svg }
  if (transientTimer) clearTimeout(transientTimer)
  transientTimer = setTimeout(() => {
    transient = null
    recompute()
  }, ms)
  recompute()
}

// ── Idle / sleep timers ──
function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

// ── Idle micro-animations ──
// While awake-but-idle (before yawning), occasionally play a brief animation from
// theme.idleAnimations (look around / think bubble / read) so the pet feels alive
// instead of frozen. Only fires in the 'idle' phase with no active runs; reschedules
// itself. Previously these theme assets were unused.
/** Stop the scheduler only (keeps any showing flourish — used when rescheduling). */
function clearIdleAnim(): void {
  if (idleAnimTimer) {
    clearTimeout(idleAnimTimer)
    idleAnimTimer = null
  }
}

/** Stop the scheduler AND drop an in-flight flourish so it can't linger over real
 * activity. Idle anims are the only transients that use the 'idle' state name. */
function cancelIdleAnim(): void {
  clearIdleAnim()
  if (transient && transient.state === 'idle') {
    transient = null
    if (transientTimer) {
      clearTimeout(transientTimer)
      transientTimer = null
    }
  }
}

function scheduleIdleAnim(): void {
  clearIdleAnim()
  const anims = loadTheme().idleAnimations
  if (!anims || !anims.length) return
  // next idle flourish in 12–26s, jittered so it doesn't look metronomic.
  const delay = 12_000 + Math.floor(Math.random() * 14_000)
  idleAnimTimer = setTimeout(() => {
    if (running && activeRuns.size === 0 && idlePhase === 'idle' && !transient) {
      const a = anims[Math.floor(Math.random() * anims.length)]
      setTransient('idle', a.duration, a.file)
    }
    scheduleIdleAnim()
  }, delay)
}

function startIdleCountdown(): void {
  clearIdleTimer()
  idlePhase = 'idle'
  scheduleIdleAnim()
  const sleepAfter = loadTheme().timings?.mouseSleepTimeout ?? SLEEP_AFTER
  idleTimer = setTimeout(() => {
    idlePhase = 'yawning'
    cancelIdleAnim() // no flourishes once the pet starts settling to sleep
    recompute()
    const yawn = loadTheme().timings?.yawnDuration ?? 3000
    idleTimer = setTimeout(() => {
      idlePhase = 'dozing'
      recompute()
      idleTimer = setTimeout(() => {
        idlePhase = 'sleeping'
        recompute()
      }, DOZE_AFTER)
    }, yawn)
  }, sleepAfter)
  recompute()
}

/** Any activity resets the idle countdown (and wakes a sleeping pet). */
function bumpActivity(): void {
  const wasAsleep = idlePhase === 'dozing' || idlePhase === 'sleeping'
  clearIdleTimer()
  clearIdleAnim()
  if (wasAsleep && activeRuns.size === 0) {
    // brief wake animation before returning to idle
    idlePhase = 'idle'
    setTransient('waking', loadTheme().timings?.wakeDuration ?? 1500)
    startIdleCountdown()
    return
  }
  idlePhase = 'idle'
}

function pollCursor(): void {
  try {
    const c = screen.getCursorScreenPoint()
    if (lastCursor && (c.x !== lastCursor.x || c.y !== lastCursor.y)) {
      if ((idlePhase === 'dozing' || idlePhase === 'sleeping') && activeRuns.size === 0) {
        bumpActivity()
      }
    }
    lastCursor = c
  } catch {
    /* screen unavailable */
  }
}

/** Feed one agent event into the machine. */
export function onAgentEventForPet(ev: AgentEvent): void {
  if (!running) return
  switch (ev.type) {
    case 'system':
    case 'session':
      activeRuns.add(ev.runId)
      clearIdleTimer()
      cancelIdleAnim()
      break
    case 'block-start':
      activeRuns.add(ev.runId)
      clearIdleTimer()
      cancelIdleAnim()
      if (ev.kind === 'thinking') lastActivity = 'thinking'
      else lastActivity = 'working' // 'tool' or 'text'
      break
    case 'tool-input':
    case 'tool-result':
    case 'block-delta':
      activeRuns.add(ev.runId)
      lastActivity = 'working'
      break
    case 'permission':
    case 'dialog':
      activeRuns.add(ev.runId)
      setTransient('notification', minDisplay('notification', 5000))
      return
    case 'result': {
      activeRuns.delete(ev.runId)
      const ok = ev.ok
      setTransient(ok ? 'attention' : 'error', minDisplay(ok ? 'attention' : 'error', ok ? 4000 : 5000))
      if (activeRuns.size === 0) startIdleCountdown()
      return
    }
    default:
      break
  }
  recompute()
}

/** Begin driving the pet (subscribe is wired in index.ts). */
export function startPetState(): void {
  running = true
  activeRuns = new Set()
  lastActivity = 'thinking'
  transient = null
  idlePhase = 'idle'
  displayed = ''
  lastCursor = null
  // Reset any lingering timers so a restart (disable→enable) doesn't double-run.
  if (transientTimer) clearTimeout(transientTimer)
  transientTimer = null
  clearIdleAnim()
  try {
    lastCursor = screen.getCursorScreenPoint()
  } catch {
    /* ignore */
  }
  if (mousePoll) clearInterval(mousePoll)
  mousePoll = setInterval(pollCursor, MOUSE_POLL)
  startIdleCountdown()
}

/** Stop and clear all timers. */
export function stopPetState(): void {
  running = false
  clearIdleTimer()
  clearIdleAnim()
  if (transientTimer) clearTimeout(transientTimer)
  if (mousePoll) clearInterval(mousePoll)
  transientTimer = null
  mousePoll = null
  activeRuns.clear()
}
