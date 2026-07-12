/**
 * Per-zone accent color — one mid-tone per HR zone (1–5) that stays legible on
 * both light and dark surfaces. Shared by the zone picker (ExerciseAddPage), the
 * entry badge (ZoneBadge), and the time-in-zone bars (ZoneBars). Zone names +
 * bpm ranges live with the math in `lib/calc.ts` (HR_ZONE_BANDS / hrZones).
 */
export const ZONE_COLORS: Record<number, string> = {
  1: '#2f7fd0', // blue — recovery
  2: '#159c6f', // green — aerobic base
  3: '#c9820f', // amber — tempo
  4: '#d1521f', // orange — threshold
  5: '#d33b3a', // red — VO₂ max
}

export const zoneColor = (zone: number): string => ZONE_COLORS[zone] ?? '#6b7280'
