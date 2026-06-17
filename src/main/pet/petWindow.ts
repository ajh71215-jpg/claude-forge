// The desktop-pet BrowserWindow: transparent, frameless, always-on-top,
// click-through. A single window combines clawd's render + hit windows — the
// renderer hit-tests the pet body and toggles setIgnoreMouseEvents via IPC.
import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { PET_SVG_BASE } from './protocol'

const WIN_SIZE = 220
const PERSIST_FILE = (): string => join(app.getPath('userData'), 'forge-pet.json')

interface PetPrefs {
  enabled?: boolean
  x?: number
  y?: number
}

export function readPetPrefs(): PetPrefs {
  try {
    return JSON.parse(readFileSync(PERSIST_FILE(), 'utf8'))
  } catch {
    return {}
  }
}

export function writePetPrefs(patch: PetPrefs): void {
  const next = { ...readPetPrefs(), ...patch }
  try {
    writeFileSync(PERSIST_FILE(), JSON.stringify(next))
  } catch {
    /* best-effort */
  }
}

let win: BrowserWindow | null = null
let dragOrigin: { cx: number; cy: number; wx: number; wy: number } | null = null
let savePosTimer: NodeJS.Timeout | null = null

/** The pet window, or null if not open. */
export function petWindow(): BrowserWindow | null {
  return win
}

/** Push a state change to the pet renderer (no-op if window is gone). */
export function sendPetState(state: string, svgFile: string): void {
  if (win && !win.isDestroyed()) win.webContents.send('pet:state', state, svgFile)
}

function defaultPosition(): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay()
  // bottom-right corner with a small margin
  return {
    x: workArea.x + workArea.width - WIN_SIZE - 24,
    y: workArea.y + workArea.height - WIN_SIZE - 24
  }
}

function persistPositionDebounced(): void {
  if (savePosTimer) clearTimeout(savePosTimer)
  savePosTimer = setTimeout(() => {
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition()
      writePetPrefs({ x, y })
    }
  }, 400)
}

let ipcRegistered = false

// Drag/interactive handlers are registered ONCE for the app lifetime and guard on
// the module-level `win`. Registering per-open (paired with removeAllListeners on
// 'closed') had a rapid enable→disable→enable race where a stale 'closed' could
// tear down the new window's listeners; a single idempotent registration avoids it.
function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.on('pet:drag-start', () => {
    if (!win) return
    const c = screen.getCursorScreenPoint()
    const [wx, wy] = win.getPosition()
    dragOrigin = { cx: c.x, cy: c.y, wx, wy }
  })
  ipcMain.on('pet:drag-move', () => {
    if (!win || !dragOrigin) return
    const c = screen.getCursorScreenPoint()
    win.setPosition(dragOrigin.wx + (c.x - dragOrigin.cx), dragOrigin.wy + (c.y - dragOrigin.cy))
  })
  ipcMain.on('pet:drag-end', () => {
    dragOrigin = null
    persistPositionDebounced()
  })
  ipcMain.on('pet:set-interactive', (_e: IpcMainEvent, on: boolean) => {
    if (!win || win.isDestroyed()) return
    if (on) win.setIgnoreMouseEvents(false)
    else win.setIgnoreMouseEvents(true, { forward: true })
  })
}

/** Create (or focus) the pet window. Idempotent. */
export function openPetWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win

  const prefs = readPetPrefs()
  const pos = prefs.x != null && prefs.y != null ? { x: prefs.x, y: prefs.y } : defaultPosition()

  win = new BrowserWindow({
    width: WIN_SIZE,
    height: WIN_SIZE,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/pet.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: ['--pet-config=' + JSON.stringify({ svgBaseUrl: PET_SVG_BASE })]
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Start click-through; the renderer flips this on body hover via IPC.
  win.setIgnoreMouseEvents(true, { forward: true })

  win.once('ready-to-show', () => win?.showInactive())
  win.on('closed', () => {
    win = null
    dragOrigin = null
  })

  registerIpc()

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/pet/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/pet/index.html'))
  }

  return win
}

/** Close the pet window if open. */
export function closePetWindow(): void {
  // Clear the debounced position-save timer so it can't fire after the window is
  // gone (it would otherwise hold the event loop open ~400ms, delaying quit).
  if (savePosTimer) clearTimeout(savePosTimer)
  savePosTimer = null
  if (win && !win.isDestroyed()) win.close()
  win = null
}
