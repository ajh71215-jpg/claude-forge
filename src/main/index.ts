import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { registerAll } from './ipc'
// Importing the pet module registers the `pet://` scheme as privileged (must
// happen before app `ready`), via a side effect in pet/protocol.ts.
import { initPet, shutdownPet } from './pet'
import { initActivity, flushActivity } from './agentActivity'
import { initMemoryCapture } from './memory'
import { interruptAll } from './agent'

// Optional remote debugging for local verification: set FORGE_CDP=<port>.
// No effect in normal use (only active when the env var is present).
if (process.env.FORGE_CDP) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.FORGE_CDP)
  app.commandLine.appendSwitch('remote-allow-origins', '*')
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#0b0a09',
    title: 'Claude Forge',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // The desktop pet is a separate always-on-top window. If it survives the main
  // window it keeps the whole Electron process alive (window-all-closed never
  // fires), so the pet leaks after the user "closes" Forge. Tear it down when the
  // main window closes so the app can actually quit. macOS keeps the app alive by
  // design (dock), so leave teardown there to before-quit.
  win.on('closed', () => {
    if (process.platform !== 'darwin') shutdownPet()
  })

  // Open external links in the OS browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // All ipcMain.handle channels, grouped by domain under ./ipc.
  registerAll(ipcMain)

  createWindow()

  // Desktop pet: installs the asset protocol and restores it if last enabled.
  initPet()

  // Agent-activity store: taps the event bus so the Squad dashboard captures
  // every run/subagent regardless of which tab is focused.
  initActivity()

  // Persistent project memory: taps the same bus to auto-capture durable tool
  // actions (file edits, commands) as recallable facts — zero extra tokens.
  initMemoryCapture()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Interrupt any in-flight runs when the windows go away or the app quits, so a
// closing window can't leave an SDK subprocess streaming (and billing) in the
// background — especially on macOS, where closing the last window doesn't quit.
app.on('window-all-closed', () => {
  void interruptAll()
  if (process.platform !== 'darwin') app.quit()
})
// On a real quit (Cmd+Q, app.quit, OS shutdown) tear down the pet, flush the
// activity store, and let in-flight SDK runs actually finish interrupting before
// the process exits — otherwise a detached subprocess can keep streaming (and
// billing) after the window is gone. We defer the quit on the FIRST pass (so the
// async interrupt can run) with a hard 2s safety cap so a hung interrupt can never
// block shutdown; the second pass (re-entered via app.quit) proceeds normally.
let quitting = false
app.on('before-quit', (e) => {
  // Always destroy the pet so it can never outlive the app, on any platform.
  shutdownPet()
  // Persist any just-finished run whose coalesced write hasn't fired yet.
  flushActivity()
  if (quitting) return
  quitting = true
  e.preventDefault()
  const finish = (): void => app.quit()
  const safety = setTimeout(finish, 2000)
  void interruptAll().finally(() => {
    clearTimeout(safety)
    finish()
  })
})
