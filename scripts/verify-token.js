// CDP verification for TOKEN levers 1 (cache panel) + 4 (cost-saver routing).
// Runs inside the renderer; returns a JSON report. No model call is made — only
// the per-prompt routing DECISION and the cache UI are exercised.
(async () => {
  const tick = () =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const q = (s) => document.querySelector(s)
  const txt = (s) => (q(s)?.textContent || '').trim()

  // Drive a React-controlled textarea: native setter + bubbling input event.
  const setTextarea = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    ).set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const report = {}

  // --- Lever 1: cache panel uses read/written/input wording ---
  report.cachePanelText = txt('.tok-cache .usage-reset')
  report.cachePanelHasReadWritten =
    /read/.test(report.cachePanelText) && /written/.test(report.cachePanelText)

  // --- Lever 4: cost-saver routing ---
  report.saverDesc = txt('.saver-desc')

  // Baseline: cost-saver OFF → no route preview.
  const cb = q('.saver-toggle input[type=checkbox]')
  report.checkboxFound = !!cb
  report.routePreviewBeforeToggle = !!q('.route-preview')

  // Turn cost-saver ON.
  if (cb && !cb.checked) cb.click()
  await tick()
  report.headerModelItem = txt('.wh-left .wh-item')

  const ta = q('.composer-input')
  report.textareaFound = !!ta

  const probe = async (label, text) => {
    setTextarea(ta, text)
    await tick()
    const preview = txt('.route-preview')
    return { label, len: text.length, preview }
  }

  const moderate =
    'Please go through the user profile page and update the copy in the header ' +
    'section so it reads more clearly for first-time visitors, then adjust the ' +
    'spacing a little and make sure the avatar lines up with the name label on ' +
    'smaller screens, and double-check the footer links still work afterwards.'

  report.trivial = await probe('rename', 'rename the variable foo to bar')
  report.hard = await probe(
    'distributed',
    'design a distributed consensus algorithm with race condition handling'
  )
  report.moderate = await probe('moderate', moderate)

  // Turn cost-saver back OFF → preview should disappear, header reverts.
  if (cb && cb.checked) cb.click()
  await tick()
  report.routePreviewAfterOff = !!q('.route-preview')
  report.headerModelAfterOff = txt('.wh-left .wh-item')

  // Assertions.
  report.PASS =
    report.cachePanelHasReadWritten &&
    report.checkboxFound &&
    report.routePreviewBeforeToggle === false &&
    /cost-saver/i.test(report.headerModelItem) &&
    /trivial/.test(report.trivial.preview) &&
    /haiku/i.test(report.trivial.preview) &&
    /hard/.test(report.hard.preview) &&
    /opus/i.test(report.hard.preview) &&
    report.routePreviewAfterOff === false

  return report
})()
