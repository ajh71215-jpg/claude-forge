// Preload for the desktop-pet window (separate from the main UI preload).
// Exposes a tiny, pet-only surface as `window.pet`. The svg asset base URL is
// injected via additionalArguments so the renderer is available synchronously
// on first paint (no async round-trip before the first frame).
import { contextBridge, ipcRenderer } from 'electron'

const arg = process.argv.find((a) => a.startsWith('--pet-config='))
const config = arg ? JSON.parse(arg.slice('--pet-config='.length)) : { svgBaseUrl: '' }

contextBridge.exposeInMainWorld('petConfig', config)

contextBridge.exposeInMainWorld('pet', {
  /** main → pet: state changed; renderer swaps the displayed svg. Returns an
   * unsubscribe fn so a reloaded renderer can drop its old listener (no leak). */
  onState: (cb: (state: string, svgFile: string) => void): (() => void) => {
    const listener = (_e: unknown, state: string, svgFile: string): void => cb(state, svgFile)
    ipcRenderer.on('pet:state', listener as (...args: unknown[]) => void)
    return () => ipcRenderer.removeListener('pet:state', listener as (...args: unknown[]) => void)
  },
  /** pet → main: begin a drag (main snapshots cursor + window origin). */
  dragStart: (): void => ipcRenderer.send('pet:drag-start'),
  /** pet → main: drag tick (main recomputes window pos from cursor delta). */
  dragMove: (): void => ipcRenderer.send('pet:drag-move'),
  /** pet → main: end drag (main persists the new position). */
  dragEnd: (): void => ipcRenderer.send('pet:drag-end'),
  /** pet → main: toggle whether the window swallows mouse events (hit-test). */
  setInteractive: (on: boolean): void => ipcRenderer.send('pet:set-interactive', !!on)
})
