// Agent Client Protocol (ACP) client over a spawned `goose acp` process
// (docs/GOOSE_INTEGRATION.md §4) — port of Octopal's AcpClient.
//
// Transport: newline-delimited JSON-RPC 2.0 over the child's stdio. Verified live
// against goose 1.37.0 (2026-06-15):
//   initialize → {result:{protocolVersion:1, agentCapabilities, authMethods}}
//   session/new {cwd, mcpServers:[]} → {result:{sessionId, modes:{...}}}
//   notification = {method:"session/update", params:{sessionId, update:{sessionUpdate:"<variant>", ...}}}
// There is NO session/cancel in this ACP version → cancellation is process kill.

import { type ChildProcessWithoutNullStreams, spawn } from 'child_process'

/** A session/update notification's inner update object (discriminator: sessionUpdate). */
export interface SessionUpdate {
  sessionUpdate: string
  [k: string]: unknown
}

/** A server→client request we must answer (e.g. session/request_permission). */
export type ServerRequestHandler = (
  method: string,
  params: Record<string, unknown>
) => unknown | Promise<unknown>

export interface AcpClientOptions {
  bin: string
  cwd: string
  env: Record<string, string>
  onUpdate?: (update: SessionUpdate, sessionId: string) => void
  onServerRequest?: ServerRequestHandler
  /** Per-request timeout (ms). Default 300_000 (goose's own prompt timeout). */
  requestTimeoutMs?: number
}

interface Pending {
  resolve: (v: Record<string, unknown>) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export class AcpClient {
  private child: ChildProcessWithoutNullStreams
  private buf = ''
  private nextId = 1
  private pending = new Map<number, Pending>()
  private opts: AcpClientOptions
  private closed = false

  constructor(opts: AcpClientOptions) {
    this.opts = opts
    this.child = spawn(opts.bin, ['acp'], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (d: string) => this.onData(d))
    this.child.on('exit', () => this.failAll(new Error('goose acp process exited')))
    this.child.on('error', (e) => this.failAll(e instanceof Error ? e : new Error(String(e))))
  }

  private onData(chunk: string): void {
    this.buf += chunk
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim()
      this.buf = this.buf.slice(i + 1)
      if (line) this.onLine(line)
    }
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      return // ignore non-JSON log noise
    }
    const method = msg.method as string | undefined
    const id = msg.id as number | undefined
    if (method === 'session/update') {
      const params = (msg.params ?? {}) as Record<string, unknown>
      const update = params.update as SessionUpdate | undefined
      if (update && this.opts.onUpdate) this.opts.onUpdate(update, String(params.sessionId ?? ''))
      return
    }
    if (method && id !== undefined) {
      // Server→client request we must answer (e.g. session/request_permission).
      void this.answerServerRequest(id, method, (msg.params ?? {}) as Record<string, unknown>)
      return
    }
    if (id !== undefined && this.pending.has(id)) {
      const p = this.pending.get(id)!
      this.pending.delete(id)
      clearTimeout(p.timer)
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
      else p.resolve((msg.result ?? {}) as Record<string, unknown>)
    }
  }

  private async answerServerRequest(
    id: number,
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    let result: unknown = {}
    try {
      if (this.opts.onServerRequest) result = await this.opts.onServerRequest(method, params)
    } catch (e) {
      this.write({ jsonrpc: '2.0', id, error: { code: -32000, message: String(e) } })
      return
    }
    this.write({ jsonrpc: '2.0', id, result })
  }

  private write(obj: unknown): void {
    if (this.closed) return
    try {
      this.child.stdin.write(JSON.stringify(obj) + '\n')
    } catch {
      /* stdin closed */
    }
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId++
    const timeoutMs = this.opts.requestTimeoutMs ?? 300_000
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`goose acp request "${method}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  // --- typed convenience wrappers (verified shapes) -------------------------

  async initialize(): Promise<Record<string, unknown>> {
    return this.request('initialize', { protocolVersion: 1, clientCapabilities: {} })
  }

  async sessionNew(cwd: string): Promise<string> {
    const res = await this.request('session/new', { cwd, mcpServers: [] })
    return String(res.sessionId ?? '')
  }

  async sessionSetMode(sessionId: string, modeId: string): Promise<void> {
    await this.request('session/set_mode', { sessionId, modeId })
  }

  /** Run one prompt turn; returns the raw result (carries stopReason). */
  async sessionPrompt(sessionId: string, text: string): Promise<Record<string, unknown>> {
    return this.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }]
    })
  }

  /** Terminate the process (no ACP cancel exists). */
  shutdown(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.child.kill('SIGTERM')
    } catch {
      /* already gone */
    }
    // Hard-kill shortly after if it lingers.
    setTimeout(() => {
      try {
        this.child.kill('SIGKILL')
      } catch {
        /* gone */
      }
    }, 1500).unref?.()
  }
}
