// Persona IPC channels (docs/MAINTAINABILITY.md Phase 4). Extracted verbatim
// from the former src/main/index.ts.

import type { IpcMain } from 'electron'
import { getPersona, setPersona, type Persona } from '../persona'

export function register(ipc: IpcMain): void {
  // Agent behavior customization (persona).
  ipc.handle('persona:get', () => getPersona())
  ipc.handle('persona:set', (_e, persona: Persona) => setPersona(persona))
}
