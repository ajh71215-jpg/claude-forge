// PERFORMANCE lever 1 runtime check (one cheap haiku call): during streaming the
// response must render as plain <pre class=response-text-stream> (O(n) append, no
// markdown reparse), and switch to <Md> (.md) exactly once on completion.
(async () => {
  const q = (s) => document.querySelector(s)
  const txt = (s) => (q(s)?.textContent || '').trim()
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const runsNow = () => {
    const m = txt('.local-cost').match(/·\s*(\d+)\s*run/)
    return m ? Number(m[1]) : 0
  }
  const runsBefore = runsNow()

  const ta = q('.composer-input')
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  ).set
  setter.call(ta, 'List 3 git commands as a markdown bullet list, each with a short description. Be brief.')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(50)
  q('.composer .send')?.click()

  // Rapid sampling during the stream.
  let sawStreamPre = false
  let maxStreamLen = 0
  let sampled = 0
  for (let i = 0; i < 200; i++) {
    const pre = q('.response-text-stream')
    if (pre) {
      sawStreamPre = true
      maxStreamLen = Math.max(maxStreamLen, (pre.textContent || '').length)
    }
    sampled++
    if (runsNow() > runsBefore) break // completed
    await sleep(30)
  }
  await sleep(500) // settle to markdown

  // Post-completion: should be rendered markdown, no leftover stream <pre>.
  const mdEl = q('.transcript .md')
  return {
    sawStreamPreDuringStream: sawStreamPre,
    maxStreamLen,
    samples: sampled,
    completed: runsNow() > runsBefore,
    mdPresentAfter: !!mdEl,
    streamPreGoneAfter: !q('.response-text-stream'),
    mdHasList: !!q('.transcript .md ul, .transcript .md li'),
    renderedTail: (q('.transcript')?.innerText || '').trim().slice(-300)
  }
})()
