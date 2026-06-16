// Patch Vite for the locked-down env: Vite's Windows realpath helper calls
// child_process.exec("net use") which defaults to cmd.exe (blocked → spawn EPERM).
// Replace that exec(...) call inside optimizeSafeRealPathSync with native realpath.
// Idempotent: a file with no `exec("net use"` left is treated as already patched.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const dir = 'node_modules/vite/dist/node/chunks'
let files
try {
  files = readdirSync(dir).filter((f) => /^dep-.*\.js$/.test(f))
} catch {
  console.log('[patch-vite] vite chunks dir not found — skip')
  process.exit(0)
}

const NEEDLE = 'exec("net use"'
const REPLACEMENT =
  '// patched (locked-down env): child_process.exec defaults to cmd.exe (blocked, spawn EPERM).\n' +
  '  // Network-drive remapping is unnecessary here — use native realpath.\n' +
  '  safeRealpathSync = fs__default.realpathSync.native;'

let patched = 0,
  already = 0
for (const f of files) {
  const fp = path.join(dir, f)
  let src = readFileSync(fp, 'utf8')
  if (!src.includes('optimizeSafeRealPathSync')) continue
  if (!src.includes(NEEDLE)) {
    already++
    continue
  }
  const start = src.indexOf(NEEDLE)
  const parenStart = src.indexOf('(', start) // the '(' of exec(
  let depth = 0,
    end = -1,
    inStr = null,
    esc = false
  for (let i = parenStart; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') inStr = c
    else if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) {
    console.log(`[patch-vite] ${f}: could not match exec() — skipped`)
    continue
  }
  let tail = end + 1
  while (tail < src.length && /\s/.test(src[tail])) tail++
  if (src[tail] === ';') tail++
  src = src.slice(0, start) + REPLACEMENT + src.slice(tail)
  writeFileSync(fp, src)
  patched++
  console.log(`[patch-vite] patched ${f}`)
}
console.log(`[patch-vite] done (patched=${patched}, already-ok=${already})`)
