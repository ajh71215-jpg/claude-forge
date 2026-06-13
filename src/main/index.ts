import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import {
  getStatus,
  setSubscription,
  setOAuthToken,
  setApiKey,
  clearAuth
} from './auth'
import { getPersona, setPersona, type Persona } from './persona'
import {
  runStreaming,
  interruptRun,
  respondPermission,
  getCapabilities,
  getSessions,
  getUsage,
  getTranscript,
  compactSession,
  type RunOptions
} from './agent'

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
  // Auth IPC. The plaintext secret never crosses back to the renderer — only
  // status (mode + whether an existing login exists) is returned.
  ipcMain.handle('auth:status', () => getStatus())
  ipcMain.handle('auth:set-subscription', () => setSubscription())
  ipcMain.handle('auth:set-oauth-token', (_e, token: string) => setOAuthToken(token))
  ipcMain.handle('auth:set-api-key', (_e, key: string) => setApiKey(key))
  ipcMain.handle('auth:clear', () => clearAuth())

  // Streaming run — events are pushed back on 'agent:event'.
  ipcMain.handle('agent:start', (e, runId: string, prompt: string, opts?: RunOptions) =>
    runStreaming(e.sender, runId, prompt, opts ?? {})
  )
  ipcMain.handle('agent:interrupt', (_e, runId: string) => interruptRun(runId))
  ipcMain.handle('agent:permission-result', (_e, id: string, allow: boolean) =>
    respondPermission(id, allow)
  )
  ipcMain.handle('agent:capabilities', () => getCapabilities())
  ipcMain.handle('agent:sessions', () => getSessions())
  ipcMain.handle('agent:usage', () => getUsage())
  ipcMain.handle('agent:transcript', (_e, sessionId: string) => getTranscript(sessionId))
  ipcMain.handle('agent:compact', (_e, sessionId: string) => compactSession(sessionId))

  // Agent behavior customization (persona).
  ipcMain.handle('persona:get', () => getPersona())
  ipcMain.handle('persona:set', (_e, persona: Persona) => setPersona(persona))

  // Custom title-bar window controls.
  ipcMain.handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.handle('window:maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w?.isMaximized()) w.unmaximize()
    else w?.maximize()
  })
  ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
