// Custom title-bar window controls (docs/MAINTAINABILITY.md Phase 4). Extracted
// verbatim from the former src/main/index.ts.

import { BrowserWindow, type IpcMain } from 'electron'

export function register(ipc: IpcMain): void {
  // Custom title-bar window controls.
  ipc.handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipc.handle('window:maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w?.isMaximized()) w.unmaximize()
    else w?.maximize()
  })
  ipc.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
}
