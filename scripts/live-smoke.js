// LIVE smoke test (makes ONE real haiku call). cost-saver ON → a trivial prompt
// routes to haiku (cheapest) and also live-exercises lever 4. Polls until the run
// completes, then returns cost/token/cache/response evidence.
(async () => {
  const q = (s) => document.querySelector(s)
  const txt = (s) => (q(s)?.textContent || '').trim()
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // cost-saver ON.
  const cb = q('.saver-toggle input[type=checkbox]')
  if (cb && !cb.checked) cb.click()
  await sleep(50)

  // Type a tiny prompt and send.
  const ta = q('.composer-input')
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  ).set
  setter.call(ta, 'Reply with exactly one word: ok')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(50)
  const preview = txt('.route-preview')
  const sendBtn = q('.composer .send')
  if (sendBtn) sendBtn.click()

  // Poll for completion: runs>=1 (onResult fires only on ok) OR an error turn.
  const runsOf = () => {
    const m = txt('.local-cost').match(/·\s*(\d+)\s*run/)
    return m ? Number(m[1]) : 0
  }
  let waited = 0
  let done = false
  let sawForging = false
  while (waited < 90000) {
    if (q('.forging')) sawForging = true
    const runs = runsOf()
    const forgingGone = sawForging && !q('.forging')
    if (runs >= 1 || forgingGone) {
      done = true
      break
    }
    await sleep(700)
    waited += 700
  }
  await sleep(400) // let final render settle

  return {
    routePreview: preview,
    completed: done,
    waitedMs: waited,
    runs: runsOf(),
    localCost: txt('.local-cost'),
    cachePanel: txt('.tok-cache .usage-reset'),
    cacheHitPct: txt('.tok-cache .usage-pct'),
    freshIn: txt('.tok-grid .tok-cell:nth-child(1) .tok-num'),
    out: txt('.tok-grid .tok-cell:nth-child(2) .tok-num'),
    transcript: (q('.transcript')?.innerText || '').trim().slice(0, 600)
  }
})()
