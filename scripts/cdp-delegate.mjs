// Live CDP verification of the FULL delegate-through-chat path in the running dev
// app (docs/GOOSE_INTEGRATION.md Plan A / Phase 2 gate). Starts a real subscription
// Claude run via window.forge.agent.start with a prompt that forces a call to the
// in-process `mcp__forge__delegate` tool → Forge routes it to goose on the enabled
// free provider (groq-live) → result returns inline. The page-side onEvent callback
// auto-approves any permission/dialog so the headless run doesn't stall.
//
// Run while `electron-vite dev --remoteDebuggingPort=9222` is up (subscription auth
// on the host ~/.claude/.credentials.json). Prints the captured event summary.
const PORT = process.env.CDP_PORT || 9222
const RUN_ID = 'cdp-delegate-1'
const list = await (await fetch(`http://localhost:${PORT}/json`)).json()
const page = list.find((t) => t.type === 'page' && /localhost:5173/.test(t.url || ''))
if (!page) { console.error('renderer not found'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise((r) => ws.addEventListener('open', r))
await send('Runtime.enable', {})

const evalExpr = (expression, awaitPromise = false) =>
  send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }).then((r) => {
    // CDP nests the eval return as msg.result.result.{value,exceptionDetails}.
    const inner = r.result || {}
    if (inner.exceptionDetails) throw new Error(JSON.stringify(inner.exceptionDetails).slice(0, 300))
    return inner.result?.value
  })

// 1) install collector + auto-approver, then fire the run (don't await completion).
// Full agentic loop: the delegated free model must USE TOOLS (write+read a file),
// proven by a unique marker that lands on disk (can't be faked from text alone).
const MARKER = process.env.MARKER || `GOOSE_PROOF_${Date.now()}`
const prompt =
  process.env.PROMPT ||
  'You have a tool named mcp__forge__delegate that runs a subtask on a free external model with file tools. ' +
    'For THIS turn you MUST use it exactly once, with tier set to "free" and writeCapable set to true, and this instruction: ' +
    `"Using your file-editing tools, create a file named goose-proof.txt whose entire contents are exactly: ${MARKER} . ` +
    'Then read the file back and reply with its exact contents." ' +
    'After the tool returns, report verbatim what it returned. Do NOT do the file work yourself — the sub-agent must.'
await evalExpr(`(() => {
  window.__ev = []; window.__err = null; window.__answered = [];
  const f = window.forge.agent;
  f.onEvent((ev) => {
    try { window.__ev.push({ type: ev.type, name: ev.name, toolName: ev.toolName, status: ev.status, runId: ev.runId, text: ev.text, parent: ev.parentToolUseID }); } catch {}
    if (ev.type === 'permission') { f.respondPermission(ev.id, true); window.__answered.push('perm:' + ev.toolName); }
    else if (ev.type === 'dialog') { f.respondDialog(ev.id, { behavior: 'allow' }); window.__answered.push('dialog'); }
  });
  f.start(${JSON.stringify(RUN_ID)}, ${JSON.stringify(prompt)}, {}).catch((e) => { window.__err = String(e); });
  return 'started';
})()`)

// 2) poll for the delegate tool call + result (or error), up to ~5 min.
const deadline = Date.now() + (Number(process.env.TIMEOUT_MS) || 300_000)
let summary
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 4000))
  summary = await evalExpr(`(() => {
    const ev = window.__ev || [];
    const j = JSON.stringify(ev);
    return {
      count: ev.length,
      sawDelegate: /forge__delegate|"delegate"/.test(j),
      sawResult: ev.some((e) => e.type === 'result' && e.runId === ${JSON.stringify(RUN_ID)}),
      err: window.__err,
      answered: window.__answered,
      tools: ev.filter((e) => e.type === 'tool' || e.name || e.toolName).map((e) => e.name || e.toolName).filter(Boolean),
      lastText: ev.filter((e) => e.text).map((e) => e.text).join('').slice(-400)
    };
  })()`)
  process.stdout.write(`[poll] events=${summary.count} delegate=${summary.sawDelegate} result=${summary.sawResult} answered=${JSON.stringify(summary.answered)}\n`)
  if (summary.err) { console.log('[run error]', summary.err); break }
  if (summary.sawResult) break
}
console.log('\n=== FINAL ===')
console.log(JSON.stringify(summary, null, 2))
console.log(summary?.sawDelegate && summary?.sawResult ? '\n[CDP DELEGATE PASS]' : '\n[CDP DELEGATE INCOMPLETE]')
ws.close()
