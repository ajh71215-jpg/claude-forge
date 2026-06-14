// PERFORMANCE Phase 0 — large-paste input→paint (NO model call). Sets a 50k-char
// value on the controlled textarea and measures time from input dispatch to the
// next painted frame. Target (PERFORMANCE.md §5): < 100ms.
(async () => {
  const q = (s) => document.querySelector(s)
  const ta = q('.composer-input')
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  ).set

  const big = 'x'.repeat(50000)
  // Warm a baseline frame.
  await new Promise((r) => requestAnimationFrame(r))

  const t0 = performance.now()
  setter.call(ta, big)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  // Wait for the paint that reflects this update.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const inputToPaintMs = Math.round(performance.now() - t0)

  // Type a few more chars to gauge per-keystroke cost with a huge value present.
  const t1 = performance.now()
  setter.call(ta, big + ' more')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const keystrokeWithBigValueMs = Math.round(performance.now() - t1)

  const valueLen = ta.value.length

  // Clear it so the smoke/orchestration tests aren't polluted.
  setter.call(ta, '')
  ta.dispatchEvent(new Event('input', { bubbles: true }))

  return {
    pastedChars: 50000,
    valueLenAfter: valueLen,
    inputToPaintMs,
    keystrokeWithBigValueMs,
    targetMs: 100,
    pass: inputToPaintMs < 100
  }
})()
