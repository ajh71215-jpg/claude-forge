// A custom `pet://` protocol that serves the bundled pet svg assets. Using a
// protocol (instead of file://) means the renderer can load assets identically
// in dev (page origin = http://localhost) and prod (page origin = file://),
// without Chromium's "not allowed to load local resource" block.
import { app, protocol, net } from 'electron'
import { pathToFileURL } from 'url'
import { join, normalize } from 'path'
import { petAssetDir } from './paths'

/** URL base the renderer prepends to an svg filename. */
export const PET_SVG_BASE = 'pet://forge/svg'

/** Must run BEFORE app `ready`. Registers the scheme as a standard origin. */
export function registerPetSchemePrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'pet', privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

let installed = false

/** Run AFTER app `ready`. Wires `pet://forge/...` to files under resources/pet. */
export function installPetProtocol(): void {
  if (installed) return
  installed = true
  const root = petAssetDir()
  protocol.handle('pet', (request) => {
    const url = new URL(request.url)
    // pathname like "/svg/clawd-idle-follow.svg"; strip leading slash.
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const target = normalize(join(root, rel))
    // Path-traversal guard: must stay within the asset root.
    if (!target.startsWith(normalize(root))) {
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(target).toString())
  })
}

// Privileged registration is required pre-ready; do it at import time so simply
// importing this module from main/index.ts (top level) is enough.
if (!app.isReady()) {
  try {
    registerPetSchemePrivileged()
  } catch {
    /* already registered */
  }
}
