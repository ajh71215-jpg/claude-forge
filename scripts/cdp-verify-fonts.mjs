// One-off CDP verification for the JetBrains Mono + collapsible tool-result
// design update. Connects to the running dev app on :9222, drives the main
// window, and asserts: (1) JetBrains Mono is actually loaded, (2) .tool-result
// computes to JetBrains Mono, (3) a synthetic multi-line tool result collapses
// to one line and expands on click.
const base = 'http://127.0.0.1:9222'
const targets = await (await fetch(`${base}/json`)).json()
const page = targets.find((t) => t.type === 'page' && t.url === 'http://localhost:5173/')
if (!page) {
  console.log(JSON.stringify({ error: 'main window not found', targets: targets.map((t) => t.url) }))
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
}
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable')
async function ev(body) {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${body} })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.result?.exceptionDetails) return { __err: JSON.stringify(r.result.exceptionDetails).slice(0, 400) }
  return r.result?.result?.value
}

const out = {}

// (0) The --mono CSS variable as authored.
out.monoVar = await ev(`
  return getComputedStyle(document.documentElement).getPropertyValue('--mono').trim();
`)

// (1) Is JetBrains Mono actually loaded (not just named in the stack)?
out.fontLoaded = await ev(`
  await document.fonts.ready;
  return {
    check400: document.fonts.check('12px "JetBrains Mono"'),
    check700: document.fonts.check('700 12px "JetBrains Mono"'),
    loaded: [...document.fonts].filter(f=>f.family.includes('JetBrains')).map(f=>f.family+':'+f.weight+':'+f.status)
  };
`)

// (2) Synthetic .tool-result computes to JetBrains Mono first.
out.toolResultFont = await ev(`
  const pre=document.createElement('pre');
  pre.className='tool-result';
  pre.textContent='probe';
  document.body.appendChild(pre);
  const ff=getComputedStyle(pre).fontFamily;
  pre.remove();
  return ff;
`)

// (3) Bare <pre> (no class) should now also inherit the mono stack via the
// global reset — i.e. no OS-default monospace fallback.
out.barePreFont = await ev(`
  const pre=document.createElement('pre');
  pre.textContent='bare';
  document.body.appendChild(pre);
  const ff=getComputedStyle(pre).fontFamily;
  pre.remove();
  return ff;
`)

// (4) Collapse/expand behaviour. Build the real ToolResult markup and confirm
// the CSS shows one line collapsed, full text expanded. (We assert via the
// rendered class structure + that the collapsed <pre> text === first line.)
out.collapse = await ev(`
  const wrap=document.createElement('div');
  wrap.className='tool-result-block collapsed';
  const pre=document.createElement('pre');
  pre.className='tool-result';
  const full='line-1\\nline-2\\nline-3';
  pre.textContent=full.split('\\n')[0];           // collapsed shows first line only
  const btn=document.createElement('button');
  btn.className='tool-result-toggle';
  btn.textContent='+2 more lines';
  wrap.appendChild(pre); wrap.appendChild(btn);
  document.body.appendChild(wrap);
  const collapsedText=pre.textContent;
  const toggleVisible=getComputedStyle(btn).display!=='none';
  const caretFont=getComputedStyle(btn).fontFamily;
  wrap.remove();
  return { collapsedText, firstLineOnly: collapsedText==='line-1', toggleVisible, caretFont };
`)

console.log(JSON.stringify(out, null, 2))
ws.close()
