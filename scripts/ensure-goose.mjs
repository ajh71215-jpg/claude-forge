// Build-time fetch of the goose binary into resources/ (docs/GOOSE_INTEGRATION.md
// §4). electron-builder then bundles resources/goose/** via extraResources, and
// src/main/goose/binary.ts resolves it at runtime under process.resourcesPath.
//
// Downloads the asset for the CURRENT platform/arch by default; pass a target
// triple dir to fetch another (e.g. `node scripts/ensure-goose.mjs win32-x64`).
// Idempotent: skips if the binary already exists.

import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { tag, host } = JSON.parse(readFileSync(join(root, 'scripts/goose-version.json'), 'utf8'))

// platform-arch dir (matches binary.ts) → goose release asset name.
const ASSETS = {
  'linux-x64': 'goose-x86_64-unknown-linux-gnu.tar.bz2',
  'linux-arm64': 'goose-aarch64-unknown-linux-gnu.tar.bz2',
  'darwin-x64': 'goose-x86_64-apple-darwin.tar.bz2',
  'darwin-arm64': 'goose-aarch64-apple-darwin.tar.bz2',
  'win32-x64': 'goose-x86_64-pc-windows-msvc.zip'
}

const target = process.argv[2] || `${process.platform}-${process.arch}`
const asset = ASSETS[target]
if (!asset) {
  console.error(`[ensure-goose] no goose asset for ${target}. Known:`, Object.keys(ASSETS).join(', '))
  process.exit(1)
}

const outDir = join(root, 'resources', 'goose', target)
const exe = join(outDir, target.startsWith('win32') ? 'goose.exe' : 'goose')
if (existsSync(exe)) {
  console.log(`[ensure-goose] already present: ${exe}`)
  process.exit(0)
}

const url = `https://github.com/${host}/releases/download/${tag}/${asset}`
const archive = join(outDir, asset)
mkdirSync(outDir, { recursive: true })
console.log(`[ensure-goose] ${target} ← ${url}`)

const res = await fetch(url, { redirect: 'follow' })
if (!res.ok) {
  console.error(`[ensure-goose] download failed: HTTP ${res.status}`)
  process.exit(1)
}
await new Promise((resolve, reject) => {
  const f = createWriteStream(archive)
  res.body.pipe?.(f) // node stream
  if (!res.body.pipe) {
    // web stream → buffer
    res.arrayBuffer().then((b) => { f.end(Buffer.from(b), resolve) }).catch(reject)
  } else {
    f.on('finish', resolve)
    f.on('error', reject)
  }
})

// Extract: .tar.bz2 via tar, .zip via unzip. The goose binary lands at top level.
const r = asset.endsWith('.zip')
  ? spawnSync('unzip', ['-o', archive, '-d', outDir], { stdio: 'inherit' })
  : spawnSync('tar', ['xjf', archive, '-C', outDir], { stdio: 'inherit' })
if (r.status !== 0) {
  console.error('[ensure-goose] extract failed (need tar/unzip on PATH)')
  process.exit(1)
}
rmSync(archive, { force: true })
if (!target.startsWith('win32')) spawnSync('chmod', ['+x', exe])

// win32: the msvc goose build dynamically links the UCRT + VC runtime. On a
// locked-down box without them it dies at spawn (0xC0000135 / 0xC000007B). Ship
// the runtime DLLs app-local (next to goose.exe) so extraResources bundles them.
// Verified fix, docs/GOOSE_INTEGRATION.md Risk #5 (2026-06-16).
// lazy: best-effort copy from the build machine's own DLLs (System32\downlevel +
// VC redist). Doesn't fail the build — just warns if a source is missing; upgrade
// path = bundle the official VC++ redist / Windows SDK ucrt\DLLs\x64 set.
if (target.startsWith('win32') && process.platform === 'win32' && existsSync(exe)) {
  const { copyFileSync, readdirSync } = await import('node:fs')
  const win = process.env.SystemRoot || 'C:\\Windows'
  let copied = 0
  // (a) UCRT api-set forwarders — ~91 tiny stubs forwarding to ucrtbase.dll.
  const downlevel = join(win, 'System32', 'downlevel')
  if (existsSync(downlevel)) {
    for (const f of readdirSync(downlevel)) {
      if (/^api-ms-win-.*\.dll$/i.test(f)) { try { copyFileSync(join(downlevel, f), join(outDir, f)); copied++ } catch {} }
    }
  } else console.warn(`[ensure-goose] ⚠ ${downlevel} missing — UCRT forwarders NOT bundled`)
  // (b) VC runtime (x64) from System32 (present when the x64 VC++ redist is
  // installed on the build machine). WindowsApps/VCLibs is NOT a reliable source
  // (ACL-protected → ENOENT via node fs), so we don't scan it.
  for (const name of ['VCRUNTIME140.dll', 'VCRUNTIME140_1.dll', 'MSVCP140.dll']) {
    const src = join(win, 'System32', name)
    if (existsSync(src)) { try { copyFileSync(src, join(outDir, name)); copied++ } catch {} }
    else console.warn(`[ensure-goose] ⚠ ${name} (x64) not in System32 — install the x64 VC++ redist on the build machine, or goose may fail on UCRT-less boxes`)
  }
  console.log(`[ensure-goose] win32 runtime: ${copied} DLL(s) placed app-local next to goose.exe`)
}
console.log(existsSync(exe) ? `[ensure-goose] ✓ ${exe}` : `[ensure-goose] ⚠ extracted but ${exe} missing — check archive layout`)
