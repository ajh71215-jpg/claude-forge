// Provider quota / error classification + cooldown (docs/GOOSE_INTEGRATION.md
// Phase 4). Free tiers rate-limit (per-minute) and exhaust (per-day); a
// misconfigured key fails every call. This module decides, from a failed
// delegation's error text, (a) whether to try the NEXT provider and (b) how long
// to skip the failing one — so the delegate tool can cycle free providers instead
// of giving up or hammering a throttled one. Pure + in-memory (no electron/SDK).

/** id → epoch-ms until which the provider should be skipped. */
const cooldownUntil = new Map<string, number>()

const MINUTE = 60_000

/** Cooldown windows by failure class. */
const COOLDOWN = {
  rate: 60 * 1000, // per-minute rate limit → short
  daily: 0, // per-day exhaustion → until local midnight (computed)
  config: 30 * MINUTE // bad/missing key → skip this session-ish
}

export interface ErrorClass {
  /** Try the next provider? (provider-side problems: rate/quota/auth/unavailable) */
  retriable: boolean
  /** Human label for logs/UI. */
  kind: 'rate' | 'daily' | 'config' | 'unavailable' | 'task'
}

const RE_DAILY = /quota|exceeded your|insufficient|out of credits|free.?tier|daily limit|per day|requests per day|RPD/i
const RE_RATE = /\b429\b|rate.?limit|too many requests|resource_exhausted|requests per minute|\bRPM\b/i
const RE_CONFIG = /api.?key|unauthor|forbidden|invalid.*key|configuration value not found|\b401\b|\b403\b|no provider|not configured/i
const RE_UNAVAIL = /\b5\d\d\b|overloaded|capacity|temporarily|unavailable|timed out|timeout|connection|ECONN/i

/** Classify a delegation error message into a failure class. */
export function classifyError(message: string): ErrorClass {
  const m = message || ''
  if (RE_DAILY.test(m)) return { retriable: true, kind: 'daily' }
  if (RE_RATE.test(m)) return { retriable: true, kind: 'rate' }
  if (RE_CONFIG.test(m)) return { retriable: true, kind: 'config' }
  if (RE_UNAVAIL.test(m)) return { retriable: true, kind: 'unavailable' }
  // Anything else is most likely a task/model issue, not provider availability —
  // don't burn other providers' quota retrying the same bad request.
  return { retriable: false, kind: 'task' }
}

/** ms until the next local midnight (for per-day exhaustion). */
function msUntilLocalMidnight(): number {
  const now = new Date()
  const midnight = new Date(now)
  midnight.setHours(24, 0, 0, 0)
  return Math.max(MINUTE, midnight.getTime() - now.getTime())
}

/** True if the provider is currently in a cooldown window (skip it). */
export function isProviderCoolingDown(id: string): boolean {
  const until = cooldownUntil.get(id)
  if (until == null) return false
  if (Date.now() >= until) {
    cooldownUntil.delete(id)
    return false
  }
  return true
}

/**
 * Record a provider result. On success, clears any cooldown. On failure, sets a
 * cooldown sized to the failure class and returns whether to try the next
 * provider. Call with the error message string on failure.
 */
export function noteProviderResult(id: string, ok: boolean, message?: string): ErrorClass {
  if (ok) {
    cooldownUntil.delete(id)
    return { retriable: false, kind: 'task' }
  }
  const cls = classifyError(message ?? '')
  const ms =
    cls.kind === 'daily'
      ? msUntilLocalMidnight()
      : cls.kind === 'config'
        ? COOLDOWN.config
        : cls.kind === 'rate' || cls.kind === 'unavailable'
          ? COOLDOWN.rate
          : 0
  if (ms > 0) cooldownUntil.set(id, Date.now() + ms)
  return cls
}
