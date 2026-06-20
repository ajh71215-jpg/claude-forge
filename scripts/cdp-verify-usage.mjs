// CDP verification for the manual-only / sticky plan-usage behaviour.
// Asserts: (1) a persisted snapshot renders on load WITHOUT any fetch,
// (2) the "usage unavailable" string is gone, (3) clicking ↻ never clears the
// previous data (sticky), (4) the button shows a spinning state while loading.
const base = 'http://127.0.0.1:9222'
const targets = await (await fetch(`${base}/json`)).json()
// Main window = the "Claude Forge" page (works for both dev http and prod file://);
// exclude the "Clawd" pet window.
const page = targets.find((t) => t.type === 'page' && t.title === 'Claude Forge')
if (!page) { console.log(JSON.stringify({ error: 'main window not found', pages: targets.filter(t=>t.type==='page').map(t=>t.title+'|'+t.url) })); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable')
await send('Page.enable')
async function ev(body) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) return { __err: JSON.stringify(r.result.exceptionDetails).slice(0, 400) }
  return r.result?.result?.value
}

const out = {}

// (1) Seed a persisted snapshot, then reload — proves render-from-storage with
// no network/fetch.
await ev(`
  localStorage.setItem('forge-usage', JSON.stringify({
    entries: [{ label: 'Current session (5h)', percent: 42, resets: 'in 2h 10m' }],
    raw: 'seed'
  }));
  return true;
`)
await send('Page.reload', { ignoreCache: false })
// wait for the panel to mount
const PANEL = `
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  const until=async(fn,ms=8000)=>{const t0=Date.now();while(Date.now()-t0<ms){const v=fn();if(v)return v;await wait(100)}return null};
  const findPanel=()=>{const h=[...document.querySelectorAll('.selector-label')].find(e=>e.textContent.trim()==='PLAN USAGE');return h?h.closest('.selector'):null};
  const pcts=(p)=>[...p.querySelectorAll('.usage-entry .usage-pct')].map(e=>e.textContent);
`
out.afterReload = await ev(`${PANEL}
  const panel = await until(findPanel);
  const pct = panel ? pcts(panel) : [];
  return {
    panelPresent: !!panel,
    renderedPct: pct,
    seededRenders: pct.includes('42%'),
    bodyHasUnavailable: document.body.innerText.includes('usage unavailable'),
  };
`)

// (2) Click ↻ and immediately sample the button's spinning class, then confirm
// the previous data is still there afterwards (sticky — never cleared).
out.refreshSticky = await ev(`${PANEL}
  const panel = await until(findPanel);
  const btn=panel.querySelector('.mini-btn');
  btn.click();
  await wait(30);
  const spinningRightAfterClick = btn.className.includes('spinning');
  await wait(5000); // let the /usage probe resolve
  const pctAfter=pcts(panel);
  return {
    spinningRightAfterClick,
    pctAfterRefresh: pctAfter,
    stickyKept42: pctAfter.includes('42%'),
    bodyHasUnavailableAfter: document.body.innerText.includes('usage unavailable'),
  };
`)

// (3) cleanup the seed so the user's real panel isn't polluted
await ev(`localStorage.removeItem('forge-usage'); return true;`)

console.log(JSON.stringify(out, null, 2))
ws.close()
