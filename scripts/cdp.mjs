// Minimal CDP driver for live renderer verification (docs/CLAUDE.md "Verifying UI
// changes"). Connects to the running app on :9222 and evaluates the JS in the file
// given as argv[2] inside the page. Prints the returned value as JSON.
//
// Usage: node scripts/cdp.mjs <expr-file.js> [port]
import { readFileSync } from 'node:fs'

const exprFile = process.argv[2]
const port = process.argv[3] || '9222'
const expression = readFileSync(exprFile, 'utf8')

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((p) => p.type === 'page')
if (!page) {
  console.error('no page target on :' + port)
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})

ws.addEventListener('open', async () => {
  await send('Runtime.enable')
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (res.result?.exceptionDetails || res.exceptionDetails) {
    console.error('EXCEPTION:', JSON.stringify(res.exceptionDetails ?? res.result.exceptionDetails, null, 2))
  }
  console.log(JSON.stringify(res.result?.value ?? res.result, null, 2))
  ws.close()
  process.exit(0)
})

ws.addEventListener('error', (e) => {
  console.error('WS error:', e.message || e)
  process.exit(1)
})
