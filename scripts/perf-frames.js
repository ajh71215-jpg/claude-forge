// PERFORMANCE Phase 0 — streaming frame-time baseline. Drives ONE streamed markdown
// response and samples requestAnimationFrame intervals throughout, so we measure the
// real hot path (incremental render under streaming). Reports jank (frames >16.7ms),
// p95/max interval, and commit count — the lever-1/2/3 target metrics. One cheap call.
(async () => {
  const q = (s) => document.querySelector(s)
  const txt = (s) => (q(s)?.textContent || '').trim()
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const runsNow = () => {
    const m = txt('.local-cost').match(/·\s*(\d+)\s*run/)
    return m ? Number(m[1]) : 0
  }
  const runsBefore = runsNow()

  // Continuous rAF interval sampler.
  const intervals = []
  let last = performance.now()
  let sampling = true
  const sample = () => {
    const now = performance.now()
    intervals.push(now - last)
    last = now
    if (sampling) requestAnimationFrame(sample)
  }
  requestAnimationFrame(() => {
    last = performance.now()
    requestAnimationFrame(sample)
  })

  // Count transcript DOM mutations during the stream = render commits.
  let commits = 0
  const tEl = q('.transcript')
  const mo = tEl
    ? new MutationObserver((muts) => {
        commits += muts.length
      })
    : null
  if (mo && tEl) mo.observe(tEl, { childList: true, subtree: true, characterData: true })

  // A prompt that produces a sizable markdown body (headings, list, code) to stress
  // incremental rendering.
  const ta = q('.composer-input')
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  ).set
  setter.call(
    ta,
    'Write ~250 words of GitHub-flavored markdown about clean code: two ## headings, ' +
      'a bullet list of 6 items, a numbered list of 4 items, one fenced code block, and ' +
      'bold/inline-code emphasis. Be thorough.'
  )
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(40)
  q('.composer .send')?.click()

  // Wait for completion (run count ticks once) or timeout.
  let waited = 0
  let sawForging = false
  while (waited < 90000) {
    if (q('.forging')) sawForging = true
    if (runsNow() > runsBefore || (sawForging && !q('.forging'))) break
    await sleep(100)
    waited += 100
  }
  await sleep(500)
  sampling = false
  if (mo) mo.disconnect()

  // Drop the first couple of warmup intervals; analyze the rest.
  const xs = intervals.slice(2).filter((x) => x > 0 && x < 1000)
  xs.sort((a, b) => a - b)
  const n = xs.length
  const pct = (p) => (n ? xs[Math.min(n - 1, Math.floor((p / 100) * n))] : 0)
  const mean = n ? xs.reduce((s, x) => s + x, 0) / n : 0
  const jank = xs.filter((x) => x > 16.7).length
  const bad = xs.filter((x) => x > 50).length

  return {
    completed: runsNow() > runsBefore,
    waitedMs: waited,
    frames: n,
    meanMs: Math.round(mean * 10) / 10,
    medianMs: Math.round(pct(50) * 10) / 10,
    p95Ms: Math.round(pct(95) * 10) / 10,
    maxMs: Math.round((xs[n - 1] || 0) * 10) / 10,
    jankFrames_gt16_7: jank,
    jankPct: n ? Math.round((jank / n) * 1000) / 10 : 0,
    badFrames_gt50: bad,
    renderCommits: commits,
    target: 'p95 < 16.7ms ideal; jankPct low',
    respLen: (q('.transcript .md')?.innerText || '').length
  }
})()
