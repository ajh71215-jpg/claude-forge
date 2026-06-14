// Tool-based verifier (docs/SQUAD_ORCHESTRATION.md §3 — the #1-ranked verifier:
// an OBJECTIVE tool oracle, not an LLM judge, so it needs NO model/live session).
// Runs project checks (typecheck / test / build) and turns pass/fail into a
// Verdict. The command runner is INJECTED so the aggregation logic is headlessly
// testable; a real child_process runner is provided for production use.
//
// This is the verifier the plan trusts most precisely because it's grounded in a
// real toolchain result — no verification gap, no reward-hacking surface.

import type { Verdict } from './orchestration'

export interface ToolCheck {
  name: string
  command: string
  cwd?: string
}

export interface ToolRunResult {
  name: string
  ok: boolean
  code: number
  output: string
}

/** Inject in tests; production passes execCommandRunner. */
export type CommandRunner = (command: string, cwd?: string) => Promise<{ code: number; output: string }>

const MAX_OUTPUT = 2000

/** Run each check via the injected runner. A non-zero exit (or throw) = fail. */
export async function runChecks(checks: ToolCheck[], run: CommandRunner): Promise<ToolRunResult[]> {
  const results: ToolRunResult[] = []
  for (const c of checks) {
    let code = 0
    let output = ''
    try {
      const r = await run(c.command, c.cwd)
      code = r.code
      output = r.output ?? ''
    } catch (e) {
      code = 1
      output = e instanceof Error ? e.message : String(e)
    }
    results.push({ name: c.name, ok: code === 0, code, output: output.slice(0, MAX_OUTPUT) })
  }
  return results
}

/** Objective verdict: pass iff EVERY check passed. Confidence 1 (tool oracle). */
export function checksToVerdict(subtaskId: string, results: ToolRunResult[]): Verdict {
  const total = results.length
  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)
  const pass = total > 0 && passed === total
  return {
    subtaskId,
    pass,
    score: total ? passed / total : 0,
    confidence: 1,
    rationale: pass
      ? `all ${total} checks passed`
      : `${failed.length}/${total} failed: ${failed.map((f) => f.name).join(', ') || 'no checks'}`,
    evidence: results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name} (exit ${r.code})`)
  }
}

/** Convenience: run checks and produce a Verdict in one call. */
export async function verifyWithTools(
  subtaskId: string,
  checks: ToolCheck[],
  run: CommandRunner
): Promise<Verdict> {
  return checksToVerdict(subtaskId, await runChecks(checks, run))
}

/**
 * Production runner: shells out via child_process. Lazy-imported so headless
 * tests that inject a fake runner never load node:child_process.
 */
export const execCommandRunner: CommandRunner = async (command, cwd) => {
  const { exec } = await import('node:child_process')
  return new Promise((resolve) => {
    exec(command, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = `${stdout ?? ''}${stderr ?? ''}`
      const code =
        err && typeof (err as { code?: unknown }).code === 'number'
          ? ((err as { code: number }).code)
          : err
            ? 1
            : 0
      resolve({ code, output })
    })
  })
}
