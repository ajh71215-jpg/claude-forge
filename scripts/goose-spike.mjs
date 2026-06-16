// goose ACP spike (docs/GOOSE_INTEGRATION.md §5, Phase 1).
//
// Standalone, no build needed. Verifies the FULL delegate lifecycle against a real
// goose binary: initialize → session/new → set_mode → session/prompt, streaming
// session/update notifications. Run it with a free provider + key to confirm an
// actual model call + tool use; run it WITHOUT a key to confirm the client
// lifecycle and capture the auth/permission message shapes.
//
// Usage:
//   GOOSE_BIN=/path/to/goose \
//   GOOSE_PROVIDER=openrouter GOOSE_MODEL='qwen/qwen3-coder:free' OPENROUTER_API_KEY=sk-... \
//   node scripts/goose-spike.mjs "Write hello() to hello.js and return its contents"
//
// Env: GOOSE_BIN (required), GOOSE_PROVIDER, GOOSE_MODEL, <KEY_ENV>, GOOSE_MODE
// (auto|approve|smart_approve|chat, default auto), GOOSE_SPIKE_CWD (default a tmp dir).

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const bin = process.env.GOOSE_BIN
if (!bin) {
  console.error('Set GOOSE_BIN=/path/to/goose')
  process.exit(2)
}
const instruction = process.argv[2] || 'Reply with exactly: SPIKE_OK'
const mode = process.env.GOOSE_MODE || 'auto'
const cwd = process.env.GOOSE_SPIKE_CWD || mkdtempSync(join(tmpdir(), 'goose-spike-'))
const home = mkdtempSync(join(tmpdir(), 'goose-home-'))

const env = {
  PATH: process.env.PATH,
  HOME: home,
  XDG_CONFIG_HOME: join(home, 'config'),
  XDG_DATA_HOME: join(home, 'data'),
  XDG_STATE_HOME: join(home, 'state'),
  GOOSE_MODE: mode
}
// Windows: a stripped env without these breaks system-DLL load (0xC0000135).
// Mirrors src/main/goose/env.ts buildGooseEnv. lazy: passthrough only the few
// vars the loader needs; the app path already does this correctly.
for (const k of ['SystemRoot', 'windir', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'COMSPEC']) {
  if (process.env[k]) env[k] = process.env[k]
}
for (const k of ['GOOSE_PROVIDER', 'GOOSE_MODEL', 'OLLAMA_HOST',
  'OPENROUTER_API_KEY', 'GOOGLE_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
  if (process.env[k]) env[k] = process.env[k]
}

console.log(`[spike] bin=${bin} provider=${env.GOOSE_PROVIDER || '(none)'} model=${env.GOOSE_MODEL || '(none)'} mode=${mode}`)
console.log(`[spike] cwd=${cwd}`)

const child = spawn(bin, ['acp'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
let buf = ''
let nextId = 1
const pending = new Map()
let textOut = ''

const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n')
const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    send({ jsonrpc: '2.0', id, method, params })
  })

child.stdout.setEncoding('utf8')
child.stdout.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (line) onLine(line)
  }
})
child.stderr.on('data', (d) => process.stderr.write('[goose-stderr] ' + d))
child.on('exit', (c) => console.log('[spike] goose exited', c))

function onLine(line) {
  let msg
  try { msg = JSON.parse(line) } catch { console.log('[non-json]', line); return }
  if (msg.method === 'session/update') {
    const u = msg.params?.update || {}
    console.log('[update]', u.sessionUpdate, JSON.stringify(u).slice(0, 200))
    if (u.sessionUpdate === 'agent_message_chunk') {
      const t = typeof u.content === 'string' ? u.content : u.content?.text || u.text || ''
      textOut += t
    }
    return
  }
  if (msg.method && msg.id !== undefined) {
    // server request (e.g. session/request_permission) — log the real shape, allow once.
    console.log('[server-request]', msg.method, JSON.stringify(msg.params).slice(0, 400))
    const opts = msg.params?.options || []
    const allow = opts.find((o) => String(o.kind || '').includes('allow'))
    send({ jsonrpc: '2.0', id: msg.id, result: allow
      ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
      : { outcome: { outcome: 'cancelled' } } })
    return
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id)
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
    else p.resolve(msg.result)
  }
}

try {
  const init = await request('initialize', { protocolVersion: 1, clientCapabilities: {} })
  console.log('[ok] initialize:', JSON.stringify(init).slice(0, 200))
  const sn = await request('session/new', { cwd, mcpServers: [] })
  console.log('[ok] session/new sessionId=', sn.sessionId, 'modes=', Object.keys(sn.modes?.availableModes || sn.modes || {}))
  const sessionId = sn.sessionId
  if (mode !== 'auto') {
    await request('session/set_mode', { sessionId, modeId: mode })
    console.log('[ok] set_mode', mode)
  }
  console.log('[..] session/prompt (needs a provider+key to actually answer)...')
  const res = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text: instruction }] })
  console.log('[ok] session/prompt stopReason=', res.stopReason)
  console.log('[result-text]\n' + textOut.trim())
  console.log('\n[SPIKE PASS] full lifecycle completed.')
} catch (e) {
  console.log('\n[lifecycle reached error]', String(e).slice(0, 300))
  console.log('(If this is an auth/provider error, the CLIENT lifecycle works — supply a key to complete the model call.)')
} finally {
  try { child.kill('SIGKILL') } catch {}
  process.exit(0)
}
