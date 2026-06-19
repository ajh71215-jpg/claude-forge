// Dependency-free combined trend chart for the COST tab: cost-per-run bars with
// a prompt-cache-hit % line overlaid (dual encoding). Pure SVG — no charting lib
// (the data is already local; a dependency would be over-engineering).
//
// The SVG stretches to the container with preserveAspectRatio="none" (bars are
// axis-aligned rects, so non-uniform scaling is artifact-free; the line uses
// vector-effect non-scaling-stroke to keep a constant width). All text lives in
// HTML siblings, never inside the stretched SVG, so nothing distorts.
import { useState, type JSX } from 'react'
import type { TrendPoint } from '../../lib/cost'
import { fmtTokens } from '../../lib/format'

const VB_W = 1000
const VB_H = 100
const TOP = 8
const BOTTOM = 94

function fmtCost(n: number): string {
  if (n <= 0) return '$0'
  if (n < 0.01) return '$' + n.toFixed(4)
  if (n < 1) return '$' + n.toFixed(3)
  return '$' + n.toFixed(2)
}

function fmtClock(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function CostChart({ points }: { points: TrendPoint[] }): JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const n = points.length
  const maxCost = Math.max(...points.map((p) => p.cost), 0.0001)
  const usable = BOTTOM - TOP
  const band = VB_W / n
  // Clamp bar width so a handful of runs don't render as fat slabs.
  const barW = Math.min(band * 0.5, 26)

  const cx = (i: number): number => band * (i + 0.5)
  const costY = (c: number): number => BOTTOM - (c / maxCost) * usable
  const hitY = (h: number): number => BOTTOM - (h / 100) * usable

  const linePts = points.map((p, i) => `${cx(i).toFixed(1)},${hitY(p.cacheHit).toFixed(1)}`).join(' ')
  const hp = hover != null ? points[hover] : null

  return (
    <div className="cost-chart-wrap">
      <div className="cost-chart-head">
        <div className="cost-chart-legend">
          <span className="cc-key cc-key-cost">
            <i /> cost / run
          </span>
          <span className="cc-key cc-key-hit">
            <i /> cache hit %
          </span>
        </div>
        <div className="cost-chart-axis">max {fmtCost(maxCost)}</div>
      </div>

      <div className="cost-chart-plot">
        <svg
          className="cost-chart-svg"
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Cost per run over time with cache-hit rate"
        >
          {/* faint baseline */}
          <line
            x1="0"
            x2={VB_W}
            y1={BOTTOM}
            y2={BOTTOM}
            stroke="var(--border)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {/* cost bars */}
          {points.map((p, i) => {
            const h = Math.max(BOTTOM - costY(p.cost), p.cost > 0 ? 1.5 : 0)
            return (
              <rect
                key={i}
                x={cx(i) - barW / 2}
                y={BOTTOM - h}
                width={barW}
                height={h}
                rx="1.5"
                className={`cc-bar${hover === i ? ' on' : ''}`}
              />
            )
          })}
          {/* cache-hit line */}
          {n > 1 && (
            <polyline
              points={linePts}
              fill="none"
              stroke="var(--ok)"
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="cc-line"
            />
          )}
          {/* hover guide + capture bands */}
          {hover != null && (
            <line
              x1={cx(hover)}
              x2={cx(hover)}
              y1={TOP - 4}
              y2={BOTTOM}
              stroke="var(--border-strong)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {points.map((_, i) => (
            <rect
              key={`h${i}`}
              x={band * i}
              y="0"
              width={band}
              height={VB_H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            />
          ))}
        </svg>

        {hp && (
          <div
            className="cost-chart-tip"
            style={{
              left: `${(cx(hover as number) / VB_W) * 100}%`,
              transform:
                (cx(hover as number) / VB_W) > 0.7 ? 'translateX(-100%)' : 'translateX(0)'
            }}
          >
            <div className="cct-when">{fmtClock(hp.t)}</div>
            <div className="cct-row">
              <span className="cct-dot cost" /> {fmtCost(hp.cost)}
            </div>
            <div className="cct-row">
              <span className="cct-dot hit" /> {hp.cacheHit}% cache
            </div>
            <div className="cct-row muted">{fmtTokens(hp.totalTokens)} tokens</div>
          </div>
        )}
      </div>

      <div className="cost-chart-foot">
        <span>{fmtClock(points[0].t)}</span>
        <span>{n} runs</span>
        <span>{fmtClock(points[n - 1].t)}</span>
      </div>
    </div>
  )
}
