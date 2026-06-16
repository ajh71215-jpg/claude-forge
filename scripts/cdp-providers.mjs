// One-shot CDP driver: live-verify the providers plumbing in the running dev app.
// Evaluates window.forge.providers.save/list in the renderer (preload→IPC→main→
// disk), proving the goose ProvidersPanel surface works end-to-end. The API key is
// read from GROQ_API_KEY env and never printed. Run while `electron-vite dev
// --remoteDebuggingPort=9222` is up.
const PORT = process.env.CDP_PORT || 9222
const key = process.env.GROQ_API_KEY || ''
if (!key) { console.error('set GROQ_API_KEY'); process.exit(2) }

const list = await (await fetch(`http://localhost:${PORT}/json`)).json()
const page = list.find((t) => t.type === 'page' && /localhost:5173/.test(t.url || ''))
if (!page) { console.error('renderer page not found; targets:', list.map((t) => t.url)); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise((r) => ws.addEventListener('open', r))

await send('Runtime.enable', {})
// async expression: confirm the API exists, save a Groq provider, list it back.
const expr = `(async () => {
  if (!window.forge?.providers) return { error: 'window.forge.providers missing' };
  const saved = await window.forge.providers.save({
    id: 'groq-live', gooseProvider: 'groq', defaultModel: 'llama-3.1-8b-instant',
    apiKeyEnv: 'GROQ_API_KEY', apiKey: ${JSON.stringify(key)},
    free: true, enabled: true
  });
  const all = await window.forge.providers.list();
  // mask secrets before returning to the debugger
  const masked = all.map(p => ({ ...p, apiKey: p.apiKey ? '***'+String(p.apiKey).length : undefined }));
  return { saveOk: saved?.ok ?? saved, count: all.length, providers: masked };
})()`
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
console.log(JSON.stringify(r.result?.value ?? r.result ?? r, null, 2))
ws.close()
