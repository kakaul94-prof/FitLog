// Pure logic for the Health Connect weight sync: pick one reading per day,
// convert to lb, and decide which days to insert. No Capacitor/Supabase imports
// so it stays unit-testable; orchestration lives in
// features/measurements/useWeightSync.ts.

/** A weigh-in record as returned by the native StepCounter.readWeights bridge. */
export interface HCWeightRecord {
  /** Local calendar day of the reading, "yyyy-MM-dd". */
  date: string
  kg: number
  /** ISO instant of the reading. */
  time: string
  /** Health Connect record id. */
  id: string
  /** Package name of the app that wrote the record (e.g. the scale app). */
  origin: string
}

export const KG_PER_LB = 0.45359237

/** kg → lb, rounded to 0.1 (matches the app's manual weigh-in granularity). */
export function kgToLb(kg: number): number {
  return Math.round((kg / KG_PER_LB) * 10) / 10
}

/**
 * Which measurement rows to insert: one per day (the LATEST reading that day,
 * scales can record several), skipping days that already have any weight row —
 * manual or previously synced — so nothing double-logs. Returns rows sorted by
 * date, values in lb.
 */
export function planWeightInserts(
  records: HCWeightRecord[],
  existingDates: Set<string>,
): { measured_on: string; value: number }[] {
  const latestByDay = new Map<string, HCWeightRecord>()
  for (const r of records) {
    if (!r.date || !Number.isFinite(r.kg) || r.kg <= 0) continue
    const prev = latestByDay.get(r.date)
    if (!prev || r.time > prev.time) latestByDay.set(r.date, r)
  }
  return [...latestByDay.values()]
    .filter((r) => !existingDates.has(r.date))
    .map((r) => ({ measured_on: r.date, value: kgToLb(r.kg) }))
    .sort((a, b) => (a.measured_on < b.measured_on ? -1 : 1))
}

/** Latest record instant, for the sync watermark. Null when there are none. */
export function maxRecordTime(records: HCWeightRecord[]): string | null {
  let max: string | null = null
  for (const r of records) {
    if (max === null || r.time > max) max = r.time
  }
  return max
}
