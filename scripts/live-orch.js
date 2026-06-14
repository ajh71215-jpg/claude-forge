// LIVE orchestration smoke: drives the REAL conductor + topology engine with
// REAL read-only SDK calls (the P0 adapter). Uses a tiny 2-subtask DAG on haiku so
// it's cheap/fast. Clicks the SQUAD tab first to also prove the RUN(live) button
// is now enabled, then invokes the live IPC channel directly and captures events.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // Switch to the SQUAD tab so the orchestration UI mounts.
  const tab = [...document.querySelectorAll('button,.tab,[role=tab]')].find((b) =>
    /squad/i.test(b.textContent || '')
  )
  if (tab) tab.click()
  await sleep(300)
  const liveBtn = document.querySelector('.orch-live')
  const btnEnabled = !!liveBtn && !liveBtn.disabled

  const events = []
  const off = window.forge.orchestrate.onEvent((ev) => events.push(ev))

  const plan = {
    goal: 'Live adapter smoke',
    budgetUsd: 2,
    subtasks: [
      {
        id: 'a',
        instruction: 'In ONE short sentence, state the time complexity of binary search.',
        topology: 'single',
        model: 'haiku',
        tools: [],
        rubric: 'answer mentions O(log n)'
      },
      {
        id: 'b',
        instruction:
          'In ONE short sentence, name a data structure with O(1) average-case lookup.',
        topology: 'single',
        model: 'haiku',
        tools: [],
        rubric: 'answer names a hash map / hash table / set',
        deps: ['a']
      }
    ],
    edges: [['a', 'b']]
  }

  const result = await window.forge.orchestrate.run(crypto.randomUUID(), plan)
  await sleep(200)
  off()

  const samples = events
    .filter((e) => e.kind === 'sample')
    .map((e) => ({ id: e.subtaskId, tier: e.tier }))
  const verifies = events
    .filter((e) => e.kind === 'conductor' && e.event.type === 'verify')
    .map((e) => ({
      id: e.event.subtaskId,
      pass: e.event.verdict?.pass,
      score: e.event.verdict?.score,
      why: (e.event.verdict?.rationale || '').slice(0, 110)
    }))
  const checkpoints = events
    .filter((e) => e.kind === 'conductor' && e.event.type === 'checkpoint')
    .map((e) => ({ id: e.event.subtaskId, spentUsd: e.event.spentUsd }))
  const done = events.find((e) => e.kind === 'done') || null

  // Monitor DOM reflection (cards driven by the same event stream).
  const cards = [...document.querySelectorAll('.orch-card')].map((c) => ({
    id: c.querySelector('.orch-card-id')?.textContent,
    status: c.querySelector('.orch-card-status')?.textContent,
    verdict: c.querySelector('.orch-verdict')?.textContent?.trim()
  }))

  return {
    btnEnabled,
    result,
    samples,
    verifies,
    checkpoints,
    done,
    monitorCards: cards,
    PASS:
      btnEnabled &&
      result.ok === true &&
      samples.length >= 2 &&
      verifies.length >= 2 &&
      (done?.artifacts || 0) >= 2
  }
})()
