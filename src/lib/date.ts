export function todayISO(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return todayISO(d)
}

/** Whole days from a -> b (positive if b is later). Both 'YYYY-MM-DD'. */
export function daysBetweenISO(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00')
  const db = new Date(b + 'T00:00:00')
  return Math.round((db.getTime() - da.getTime()) / 86_400_000)
}

/** Wall-clock time from an ISO timestamp, e.g. "3:45p" (24h locales: "15:45"). */
export function timeLabel(iso: string): string {
  const s = new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
  return s.replace(/\s?([AP])M$/i, (_, m) => m.toLowerCase())
}

export function dateLabel(iso: string): string {
  const t = todayISO()
  if (iso === t) return 'Today'
  if (iso === addDaysISO(t, -1)) return 'Yesterday'
  if (iso === addDaysISO(t, 1)) return 'Tomorrow'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
