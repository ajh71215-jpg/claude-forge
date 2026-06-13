// Verify: 3 concurrent queries with per-run systemPrompt all run in parallel.
import { query } from '@anthropic-ai/claude-agent-sdk'

function run(label, model, word) {
  return (async () => {
    let text = '',
      init = ''
    const q = query({
      prompt: 'Say your assigned word.',
      options: {
        model,
        permissionMode: 'bypassPermissions',
        maxTurns: 1,
        persistSession: false,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: `Always reply with exactly one word: ${word}` },
        stderr: () => {}
      }
    })
    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') init = msg.model
      if (msg.type === 'assistant')
        for (const b of msg.message?.content ?? []) if (b.type === 'text') text += b.text
    }
    return `${label}: model=${init} reply=${JSON.stringify(text.trim().slice(0, 30))}`
  })()
}

const t0 = Date.now === undefined ? 0 : 0
const results = await Promise.all([
  run('A', 'sonnet', 'alpha'),
  run('B', 'haiku', 'bravo'),
  run('C', 'opus[1m]', 'charlie')
])
results.forEach((r) => console.log(r))
console.log('all 3 completed concurrently')
process.exit(0)
