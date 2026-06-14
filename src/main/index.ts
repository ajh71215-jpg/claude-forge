import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { registerAll } from './ipc'
// Importing the pet module registers the `pet://` scheme as privileged (must
// happen before app `ready`), via a side effect in pet/protocol.ts.
import { initPet } from './pet'

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
