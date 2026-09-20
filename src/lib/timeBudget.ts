/** Time-budget workouts — fit a template into the time you actually have.
 *
 *  The point is consistency: a trimmed session you do beats a full one you
 *  skip. Nothing here guesses how long a set takes — it divides the routine's
 *  own measured estimate (median of your recent runs, via
 *  `estimateRoutineMinutes`) by its target sets, so the maths is personal and
 *  gets better the more you log.
 *
 *  Trim ladder, in order, stopping the moment it fits:
 *    1. shave sets off OPTIONAL lifts (biggest first, floor `MIN_SETS`)
 *    2. drop OPTIONAL lifts entirely, from the bottom of the routine up
 *    3. shave sets off CORE lifts (same floor)
 *    4. give up — core lifts are never dropped, so a routine has a floor
 *       below which it simply doesn't go (`fits: false`).
 */

/** Never shave an exercise below this — one working set isn't a session. */
export const MIN_SETS = 2

/** A missing target_sets counts as 3, matching `estimateRoutineMinutes`. */
export const ASSUMED_SETS = 3

export interface BudgetItem {
  id: string
  name: string
  /** Target sets; null/0 is read as `ASSUMED_SETS`. */
  sets: number | null
  isOptional: boolean
}

export interface TrimmedItem {
  id: string
  name: string
  /** Sets the template asks for. */
  sets: number
  isOptional: boolean
  /** Sets after trimming. 0 = dropped from the session. */
  keptSets: number
}

export interface TrimResult {
  items: TrimmedItem[]
  /** Sets kept across every exercise. */
  totalSets: number
  /** Sets the untrimmed template asks for. */
  fullSets: number
  estMinutes: number
  fullMinutes: number
  /** False when the ladder bottomed out and it's still over budget. */
  fits: boolean
  /** True when nothing was cut (budget already covered the full session). */
  untouched: boolean
}

const setsOf = (i: BudgetItem): number =>
  i.sets && i.sets > 0 ? i.sets : ASSUMED_SETS

/** Minutes one set costs you, from the routine's measured estimate. Null when
 *  there's nothing to divide (no estimate yet, or no sets). */
export function minutesPerSet(
  estMinutes: number | null | undefined,
  totalSets: number,
): number | null {
  if (!estMinutes || estMinutes <= 0 || totalSets <= 0) return null
  return estMinutes / totalSets
}

/** Shave one set at a time off the biggest matching exercise until it fits.
 *  Ties go to the LAST match, so the bottom of the routine gives first. */
function shave(
  items: TrimmedItem[],
  match: (i: TrimmedItem) => boolean,
  allowed: number,
  total: number,
): number {
  for (;;) {
    if (total <= allowed) return total
    let pick: TrimmedItem | null = null
    for (const it of items) {
      if (!match(it) || it.keptSets <= MIN_SETS) continue
      if (!pick || it.keptSets >= pick.keptSets) pick = it
    }
    if (!pick) return total
    pick.keptSets--
    total--
  }
}

/** Fit `items` (in routine order) into `budgetMin` minutes.
 *  A null/0 budget, or no usable per-set estimate, returns the full session. */
export function trimToBudget(
  items: BudgetItem[],
  budgetMin: number | null | undefined,
  minPerSet: number | null | undefined,
): TrimResult {
  const list: TrimmedItem[] = items.map((i) => ({
    id: i.id,
    name: i.name,
    sets: setsOf(i),
    isOptional: i.isOptional,
    keptSets: setsOf(i),
  }))
  const fullSets = list.reduce((s, i) => s + i.sets, 0)
  const per = minPerSet && minPerSet > 0 ? minPerSet : null
  const fullMinutes = per ? Math.round(fullSets * per) : 0

  const done = (total: number, fits: boolean): TrimResult => ({
    items: list,
    totalSets: total,
    fullSets,
    estMinutes: per ? Math.round(total * per) : 0,
    fullMinutes,
    fits,
    untouched: total === fullSets,
  })

  if (!budgetMin || budgetMin <= 0 || !per) return done(fullSets, true)

  // Sets that fit in the budget. Floor, so the estimate lands at or under it.
  const allowed = Math.floor(budgetMin / per)
  let total = fullSets
  if (total <= allowed) return done(total, true)

  // 1 — thin out the optional work.
  total = shave(list, (i) => i.isOptional, allowed, total)
  // 2 — drop optional lifts from the bottom up.
  for (let i = list.length - 1; i >= 0 && total > allowed; i--) {
    const it = list[i]
    if (!it.isOptional || it.keptSets === 0) continue
    total -= it.keptSets
    it.keptSets = 0
  }
  // 3 — only now touch the core lifts.
  total = shave(list, (i) => i.keptSets > 0, allowed, total)

  return done(total, total <= allowed)
}

/** "6 exercises · 19 sets" style summary of what you're about to start. */
export function trimSummary(r: TrimResult): string {
  const kept = r.items.filter((i) => i.keptSets > 0).length
  return `${kept} exercise${kept === 1 ? '' : 's'} · ${r.totalSets} set${
    r.totalSets === 1 ? '' : 's'
  }`
}
