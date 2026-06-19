// MFP-style calorie dial for the diary hero. Track = adjusted budget
// (goal + exercise burned), green arc = food consumed as a fraction of it, so
// "ring full" lines up exactly with "0 remaining". Over budget keeps the green
// ring full and draws a red overshoot arc on top showing how far past you went.
// Muted palette (ring-local, not the global primary token).

const R = 50
const C = 2 * Math.PI * R

// Ring-local muted colors. Exported so the diary macro bars can match the ring
// without recoloring the global `primary` token (buttons/nav stay as-is).
export const RING_GREEN = '#54976e'
export const RING_OVER = '#bf6360'

export function CalorieRing({
  consumed,
  goal,
  burned,
  size = 132,
}: {
  consumed: number
  goal: number
  burned: number
  size?: number
}) {
  const budget = goal + burned
  const remaining = Math.round(budget - consumed)
  const over = remaining < 0
  const fillFrac = budget > 0 ? Math.min(1, consumed / budget) : 0
  const overFrac =
    over && budget > 0 ? Math.min(1, (consumed - budget) / budget) : 0
  const fillDash = `${(fillFrac * C).toFixed(1)} ${C.toFixed(1)}`
  const overDash = `${(overFrac * C).toFixed(1)} ${C.toFixed(1)}`
  const abs = Math.abs(remaining)

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={
        over ? `${abs} calories over budget` : `${remaining} calories remaining`
      }
    >
      {/* track — theme token so it adapts to dark mode */}
      <circle
        cx="60"
        cy="60"
        r={R}
        fill="none"
        stroke="var(--muted)"
        strokeWidth="10"
      />
      {/* food consumed (full circle once over budget) */}
      <circle
        cx="60"
        cy="60"
        r={R}
        fill="none"
        stroke={RING_GREEN}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={over ? undefined : fillDash}
        transform="rotate(-90 60 60)"
        style={{ transition: 'stroke-dasharray .5s ease' }}
      />
      {/* overshoot — how far past budget */}
      {over && (
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke={RING_OVER}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={overDash}
          transform="rotate(-90 60 60)"
        />
      )}
      <text
        x="60"
        y="58"
        textAnchor="middle"
        fontSize="26"
        fontWeight="700"
        fill={over ? RING_OVER : 'var(--foreground)'}
      >
        {over ? `−${abs}` : remaining}
      </text>
      <text
        x="60"
        y="76"
        textAnchor="middle"
        fontSize="11"
        fill="var(--muted-foreground)"
      >
        {over ? `${abs} over` : 'remaining'}
      </text>
    </svg>
  )
}
