// Dump the collected window.__ev from the running dev app (companion to
// cdp-delegate.mjs). No bash quoting; reads the event array the collector built.
const PORT = process.env.CDP_PORT || 9222
const j = await (await fetch(`http://localhost:${PORT}/json`)).json()
const page = j.find((t) => t.type === 'page' && /localhost:5173\/?$/.test(t.url || '') && !/\/pet\//.test(t.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const p = new Map()
const send = (m, pa) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: pa })) })
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } })
await new Promise((r) => ws.addEventListener('open', r))
await send('Runtime.enable', {})

const expr = `JSON.stringify({
  count: (window.__ev||[]).length,
  answered: window.__answered||[],
  err: window.__err||null,
  ev: (window.__ev||[]).map(e => ({ t:e.type, name:e.name, tool:e.toolName, status:e.status, parent:e.parent, text:(e.text||'').slice(0,120) }))
})`
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
const v = r.result?.result?.value
if (!v) { console.error('no value; raw:', JSON.stringify(r).slice(0, 300)); process.exit(1) }
const data = JSON.parse(v)
console.log('count:', data.count, '| answered:', JSON.stringify(data.answered), '| err:', data.err)
for (const e of data.ev) console.log(JSON.stringify(e))
const blob = JSON.stringify(data.ev)
console.log('\nsawDelegate:', /forge__delegate|delegate/i.test(blob))
console.log('sawResult:', data.ev.some((e) => e.t === 'result'))
ws.close()
