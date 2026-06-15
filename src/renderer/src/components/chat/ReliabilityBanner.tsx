// Reliability banner over the composer: api-retry / subscription rate-limit /
// auto-compaction awareness, all from events the SDK already streams (no extra
// tokens). Extracted from Composer.tsx (behavior-preserving) — pure presentational.
import type { JSX } from 'react'
import type { Reliability } from './useAgentEvents'

export default function ReliabilityBanner({
  reliability,
  onDismissCompact
}: {
  reliability: Reliability | null
  onDismissCompact: () => void
}): JSX.Element | null {
  if (!reliability || !(reliability.retry || reliability.rate || reliability.compact)) return null
  return (
    <div className="reliability">
      {reliability.retry && (
        <div className="rb-item retry">
          <span className="rb-spin" aria-hidden /> Retrying
          {reliability.retry.status ? ` (${reliability.retry.status})` : ''} — attempt{' '}
          {reliability.retry.attempt}/{reliability.retry.max}…
        </div>
      )}
      {reliability.rate && (
        <div className={`rb-item rate ${reliability.rate.status}`}>
          ⚠ Rate limit{reliability.rate.rateLimitType ? ` (${reliability.rate.rateLimitType})` : ''}
          {typeof reliability.rate.utilization === 'number'
            ? ` — ${Math.round(reliability.rate.utilization * 100)}% used`
            : ''}
          {reliability.rate.resetsAt
            ? ` · resets ${new Date(
                reliability.rate.resetsAt > 1e12
                  ? reliability.rate.resetsAt
                  : reliability.rate.resetsAt * 1000
              ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : ''}
        </div>
      )}
      {reliability.compact && (
        <div className="rb-item compact">
          ✦ Context {reliability.compact.trigger === 'auto' ? 'auto-' : ''}compacted
          {reliability.compact.pre
            ? ` — ${Math.round(reliability.compact.pre / 1000)}k→${
                reliability.compact.post ? Math.round(reliability.compact.post / 1000) + 'k' : '…'
              } tokens`
            : ''}
          <button className="rb-x" title="Dismiss" onClick={onDismissCompact}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
