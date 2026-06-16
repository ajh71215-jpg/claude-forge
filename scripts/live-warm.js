// Second LIVE haiku call → WARM cache. The first call wrote ~21.7k tokens to the
// prompt cache; this call should READ most of that back (cache read = 0.1x price),
// demonstrating lever 1's actual value. Captures per-run cost delta.
(async () => {
  const q = (s) => document.querySelector(s)
  const txt = (s) => (q(s)?.textContent || '').trim()
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const costNow = () => {
    const m = txt('.local-cost').match(/\$([0-9.]+)/)
    return m ? Number(m[1]) : 0
  }
  const runsNow = () => {
    const m = txt('.local-cost').match(/·\s*(\d+)\s*run/)
    return m ? Number(m[1]) : 0
  }

  const costBefore = costNow()
  const runsBefore = runsNow()

  const ta = q('.composer-input')
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  ).set
  setter.call(ta, 'Reply with exactly one word: yes')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(50)
  const sendBtn = q('.composer .send')
  if (sendBtn) sendBtn.click()

  let waited = 0
  let sawForging = false
  while (waited < 90000) {
    if (q('.forging')) sawForging = true
    if (runsNow() > runsBefore || (sawForging && !q('.forging'))) break
    await sleep(700)
    waited += 700
  }
  await sleep(400)

  return {
    runsBefore,
    runsAfter: runsNow(),
    costBefore,
    costAfter: costNow(),
    perRunCostDelta: Number((costNow() - costBefore).toFixed(4)),
    cachePanelCumulative: txt('.tok-cache .usage-reset'),
    cacheHitPctCumulative: txt('.tok-cache .usage-pct'),
    transcriptTail: (q('.transcript')?.innerText || '').trim().slice(-400)
  }
})()
