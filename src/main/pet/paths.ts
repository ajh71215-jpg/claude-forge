// Pet asset path resolution (dev vs packaged).
//
// Assets live in the repo at `resources/pet/{theme.json,svg/*.svg}` and are
// shipped via electron-builder `extraResources` to `<resourcesPath>/pet/` in a
// packaged build. In electron-vite dev the main process runs from `out/main`,
// but `app.getAppPath()` resolves to the project root, so the repo path works.
import { app } from 'electron'
import { join } from 'path'

/** Absolute path to the bundled pet asset directory (theme.json + svg/). */
export function petAssetDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'pet')
    : join(app.getAppPath(), 'resources', 'pet')
}

/** Absolute path to the Clawd theme manifest. */
export function petThemePath(): string {
  return join(petAssetDir(), 'theme.json')
}
