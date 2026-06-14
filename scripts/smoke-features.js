// Non-destructive feature smoke probe. Clicks through every top tab + every EXTEND
// panel and asserts each view actually MOUNTS with content (no error boundary, no
// dead 'coming next' stub, IPC-backed lists load). Costs ZERO tokens — no model
// call, no mutation. Returns a structured pass/fail per surface so we can answer
// "are all features usable?" from observed behavior, not assumption.
(async () => {
  const q = (s) => document.querySelector(s)
  const qa = (s) => [...document.querySelectorAll(s)]
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const txt = (el) => (el?.innerText || '').trim()

  // Catch runtime errors raised from here on (clicks may trigger them).
  const errors = []
  window.addEventListener('error', (e) => errors.push(String(e.message || e.error)))
  window.addEventListener('unhandledrejection', (e) => errors.push('reject: ' + String(e.reason)))

  const out = { tabs: {}, extend: {}, squad: {}, chat: {}, errors: [] }

  // ---- top tabs (.mode-tab → chat/squad/extend) ----
  const tabs = qa('.mode-tab')
  out.tabCount = tabs.length
  for (const t of tabs) {
    const label = txt(t).toLowerCase().replace(/[^a-z]/g, '') || 'tab'
    t.click()
    await sleep(350)
    const pane = qa('.view-pane').find((p) => getComputedStyle(p).display !== 'none')
    out.tabs[label] = {
      mounted: !!pane,
      children: pane ? pane.querySelectorAll('*').length : 0,
      textLen: pane ? txt(pane).length : 0,
      errorBoundary: /something went wrong|error boundary/i.test(txt(pane))
    }
  }

  // ---- EXTEND: click each of the 6 panels ----
  qa('.mode-tab').find((t) => /extend/i.test(txt(t)))?.click()
  await sleep(300)
  const navItems = qa('.extend-nav-item')
  out.extend.panelCount = navItems.length
  out.extend.panels = {}
  for (const it of navItems) {
    const name = txt(it).toLowerCase().replace(/[^a-z]/g, '')
    it.click()
    await sleep(300)
    const body = q('.extend-body')
    out.extend.panels[name] = {
      mounted: !!body,
      textLen: txt(body).length,
      isStub: !!q('.extend-stub'), // dead "coming next" placeholder — should be false everywhere
      hasControls: (body?.querySelectorAll('button,input,textarea,select').length || 0)
    }
  }

  // ---- SQUAD: controls present & enabled (dry-run is the free path) ----
  qa('.mode-tab').find((t) => /squad/i.test(txt(t)))?.click()
  await sleep(300)
  const dry = q('.orch-dry')
  const live = q('.orch-live')
  out.squad = {
    goalInput: !!q('.squad-view textarea, .view-pane textarea'),
    dryRunBtn: !!dry,
    dryRunEnabled: dry ? !dry.disabled : false,
    liveBtn: !!live,
    liveEnabled: live ? !live.disabled : false,
    subtaskRows: qa('.view-pane input[placeholder="instruction"]').length
  }

  // ---- CHAT: composer present ----
  qa('.mode-tab').find((t) => /chat/i.test(txt(t)))?.click()
  await sleep(300)
  const composer = q('.composer-input')
  out.chat = {
    composer: !!composer,
    sendBtn: !!q('.composer .send'),
    composerEnabled: composer ? !composer.disabled : false
  }

  out.errors = errors
  // verdict
  const tabsOk = Object.values(out.tabs).every((t) => t.mounted && t.children > 3 && !t.errorBoundary)
  const extOk =
    out.extend.panelCount === 6 &&
    Object.values(out.extend.panels).every((p) => p.mounted && !p.isStub && p.textLen > 0)
  const squadOk = out.squad.dryRunBtn && out.squad.liveBtn
  const chatOk = out.chat.composer && out.chat.sendBtn
  out.PASS = tabsOk && extOk && squadOk && chatOk && errors.length === 0
  out.summary = { tabsOk, extOk, squadOk, chatOk, errorCount: errors.length }
  return out
})()
