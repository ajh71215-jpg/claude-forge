// Public surface for the desktop pet: enable/disable + lifecycle wiring.
// initPet() installs the asset protocol; setPetEnabled() opens/closes the window
// and subscribes the state machine to the agent event bus.
import { installPetProtocol } from './protocol'
import { openPetWindow, closePetWindow, readPetPrefs, writePetPrefs, petWindow } from './petWindow'
import { onAgentEvent } from './bus'
import { onAgentEventForPet, startPetState, stopPetState } from './petState'

let unsubscribe: (() => void) | null = null
let enabled = false

/** Whether the pet is currently enabled (persisted preference). */
export function isPetEnabled(): boolean {
  return enabled
}

function enable(): void {
  if (enabled) return
  enabled = true
  const win = openPetWindow()
  unsubscribe = onAgentEvent(onAgentEventForPet)
  win.webContents.once('did-finish-load', () => startPetState())
}

function disable(): void {
  if (!enabled) return
  enabled = false
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  stopPetState()
  closePetWindow()
}

/** Call once after app `ready`. Restores the pet if it was enabled last run. */
export function initPet(): void {
  installPetProtocol()
  if (readPetPrefs().enabled) enable()
}

/** Toggle/set the pet on or off and persist the choice. Returns new state. */
export function setPetEnabled(on: boolean): boolean {
  if (on) enable()
  else disable()
  writePetPrefs({ enabled: on })
  return enabled
}

/** Convenience toggle. Returns the new enabled state. */
export function togglePet(): boolean {
  return setPetEnabled(!enabled)
}

export { petWindow }
