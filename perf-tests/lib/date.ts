// Calendar dates as YYYY-MM-DD, in UTC. The seed and the journeys use the same
// helpers, so "today" is the same day on both sides whatever the host's zone.
const DAY_MS = 24 * 60 * 60 * 1000

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function addDaysISO(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A timestamp on `iso` at `hour`:`minute` UTC. */
export function at(iso: string, hour: number, minute = 0): string {
  return `${iso}T${pad(hour)}:${pad(minute)}:00.000Z`
}
