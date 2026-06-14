// CDP screenshot of the running renderer → PNG. Usage: node scripts/cdp-shot.mjs <out.png> [port]
import { writeFileSync } from 'node:fs'

const out = process.argv[2] || 'shot.png'
const port = process.argv[3] || '9222'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((p) => p.type === 'page')
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
  await send('Page.enable')
  const res = await send('Page.captureScreenshot', { format: 'png' })
  if (res.result?.data) {
    writeFileSync(out, Buffer.from(res.result.data, 'base64'))
    console.log('SAVED ' + out)
  } else {
    console.error('no screenshot data', JSON.stringify(res).slice(0, 200))
  }
  ws.close()
  process.exit(0)
})
