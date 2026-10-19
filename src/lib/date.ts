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

/** Wall-clock time from an ISO timestamp, e.g. "3:45p". Always 12-hour, even
 *  when the phone's locale defaults to 24-hour. */
export function timeLabel(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`
}

/** An `<input type="time">` value ("15:45") as "3:45 PM". */
export function hhmmLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
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

/**
 * Consecutive-day streak ending at `today` — or yesterday, as a morning grace
 * period — from a collection of logged 'YYYY-MM-DD' dates. Pure core of
 * useStreak: computed from the data, so backfilling a missed day heals the gap.
 */
export function computeStreak(
  loggedDates: Iterable<string>,
  today: string,
): number {
  const logged =
    loggedDates instanceof Set ? loggedDates : new Set(loggedDates)
  let day = today
  if (!logged.has(day)) day = addDaysISO(day, -1) // morning grace
  let count = 0
  while (logged.has(day)) {
    count++
    day = addDaysISO(day, -1)
  }
  return count
}
