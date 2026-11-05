// How hard a set was, shown as RPE or RIR. It's always STORED as RPE
// (workout_sets.effort, 1 easy … 10 max) on the RIR-based RPE scale (Zourdos
// et al. 2016): RPE 10 = 0 reps in reserve, 9 = 1, … 6 = 4. The profile's
// effort_scale only changes what's shown and picked, so the coach and the
// progression engine keep reading one number either way.

export type EffortScale = 'rpe' | 'rir'

// Below RPE 6 the scale stops counting reps ("light effort"), so RIR collapses
// everything easier than 4 in reserve into one "5+" bucket, stored as RPE 5.
const RIR_FLOOR_RPE = 5

/** Column header / short name for the scale. */
export function effortName(scale: EffortScale): 'RPE' | 'RIR' {
  return scale === 'rir' ? 'RIR' : 'RPE'
}

/** Bare value as the picker shows it: "8" in RPE, "2" or "5+" in RIR. */
export function effortValue(rpe: number, scale: EffortScale): string {
  if (scale === 'rpe') return String(rpe)
  return rpe <= RIR_FLOOR_RPE ? '5+' : String(10 - rpe)
}

/** Inline text for a stored rating: "RPE 8" or "2 RIR". */
export function effortText(rpe: number, scale: EffortScale): string {
  return scale === 'rir' ? `${effortValue(rpe, 'rir')} RIR` : `RPE ${rpe}`
}

/** Picker options in display order; `value` is the RPE that gets stored. */
export function effortOptions(
  scale: EffortScale,
): { value: number; label: string }[] {
  const rpes =
    scale === 'rpe'
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      : [10, 9, 8, 7, 6, RIR_FLOOR_RPE] // 0, 1, 2, 3, 4, 5+ RIR
  return rpes.map((v) => ({ value: v, label: effortValue(v, scale) }))
}

/**
 * The option a stored rating selects. Old RPE 1–4 sets have no RIR option of
 * their own, so they show as "5+" — display only; the stored value is kept
 * until you pick something else.
 */
export function effortOptionValue(rpe: number, scale: EffortScale): number {
  return scale === 'rir' ? Math.max(rpe, RIR_FLOOR_RPE) : rpe
}
