import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ageFromBirthDate,
  bmi,
  bmrMifflin,
  caloriesForRate,
  cmToFtIn,
  distanceCalories,
  distanceCoef,
  effectiveWeightLb,
  levelMet,
  paceAwareCalories,
  estimateAdaptiveTDEE,
  estimated1RM,
  ftInToCm,
  GOAL_HISTORY_BASELINE_DATE,
  goalForDate,
  hrMax,
  hrZones,
  kgToLb,
  lbToKg,
  metCalories,
  movingAverage,
  recordGoalChange,
  resolveCalorieGoal,
  resolveMacroTargets,
  resolveMaxHr,
  roundHalf,
  tdee,
  warmupRamp,
  zoneForHr,
} from './calc'
import type { MacroTargets, Profile } from './database.types'

describe('unit conversions', () => {
  it('converts lb <-> kg', () => {
    expect(lbToKg(220.46226218)).toBeCloseTo(100, 5)
    expect(kgToLb(100)).toBeCloseTo(220.46226, 4)
  })
  it('round-trips lb -> kg -> lb', () => {
    expect(kgToLb(lbToKg(150))).toBeCloseTo(150, 6)
  })
  it('converts cm to feet/inches (rounded)', () => {
    expect(cmToFtIn(180)).toEqual({ ft: 5, inch: 11 })
    expect(cmToFtIn(152.4)).toEqual({ ft: 5, inch: 0 })
  })
  it('converts feet/inches back to cm', () => {
    expect(ftInToCm(5, 11)).toBeCloseTo(180.34, 2)
  })
})

describe('heart-rate zones', () => {
  it('estimates max HR via Tanaka', () => {
    expect(hrMax(30)).toBe(187) // 208 − 0.7·30 = 187
    expect(hrMax(40)).toBe(180)
  })
  it('derives 5 %HRmax bpm ranges from a max HR', () => {
    const z = hrZones(190)
    expect(z).toHaveLength(5)
    expect(z[0]).toMatchObject({ zone: 1, loBpm: 95, hiBpm: 114 })
    expect(z[4]).toMatchObject({ zone: 5, loBpm: 171, hiBpm: 190 })
  })
  it('maps an average HR to its zone (%HRmax)', () => {
    const max = 190
    expect(zoneForHr(90, max)).toBeNull() // <50% max
    expect(zoneForHr(100, max)).toBe(1)
    expect(zoneForHr(140, max)).toBe(3)
    expect(zoneForHr(180, max)).toBe(5)
    expect(zoneForHr(0, max)).toBeNull()
  })
  it('uses Karvonen reserve when a resting HR is given', () => {
    const max = 190
    const rest = 55 // reserve 135
    expect(hrZones(max, rest)[1]).toMatchObject({
      zone: 2,
      loBpm: 136, // 55 + 0.6·135
      hiBpm: 150, // 55 + 0.7·135 = 149.5 → 150
    })
    // 136 bpm is Zone 2 by reserve, but Zone 3 by raw %HRmax (~72%).
    expect(zoneForHr(136, max, rest)).toBe(2)
    expect(zoneForHr(136, max)).toBe(3)
  })
  it('falls back to %HRmax for an unusable resting HR', () => {
    const max = 190
    expect(hrZones(max, 0)).toEqual(hrZones(max))
    expect(hrZones(max, 200)).toEqual(hrZones(max)) // rest ≥ max
    expect(zoneForHr(140, max, 0)).toBe(zoneForHr(140, max))
  })
  it('resolves max HR from a profile (manual overrides age)', () => {
    const prof = (max_hr: number | null, birth_date: string | null) =>
      ({ max_hr, birth_date }) as unknown as Profile
    expect(resolveMaxHr(prof(195, '1990-01-01'))).toBe(195)
    const age = ageFromBirthDate('1990-01-01')!
    expect(resolveMaxHr(prof(null, '1990-01-01'))).toBe(hrMax(age))
    expect(resolveMaxHr(prof(null, null))).toBeNull()
  })
})

describe('roundHalf', () => {
  it('rounds to the nearest half', () => {
    expect(roundHalf(2.24)).toBe(2)
    expect(roundHalf(2.26)).toBe(2.5)
    expect(roundHalf(7)).toBe(7)
  })
})

describe('ageFromBirthDate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 26, 12, 0, 0)) // 2026-06-26
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null for missing or invalid input', () => {
    expect(ageFromBirthDate(null)).toBeNull()
    expect(ageFromBirthDate('not-a-date')).toBeNull()
  })
  // Birthdays well clear of "today" so the assertion is timezone-robust (the
  // function parses the date as UTC but compares against local "now").
  it('counts a birthday earlier in the year as reached', () => {
    expect(ageFromBirthDate('1996-01-15')).toBe(30)
  })
  it('does not count a birthday later in the year', () => {
    expect(ageFromBirthDate('1996-12-15')).toBe(29)
  })
})

describe('bmrMifflin', () => {
  // 176.37 lb ~= 80 kg; 10*80 + 6.25*180 - 5*30 = 1775, then +5 (male) / -161 (female).
  it('uses the male offset', () => {
    expect(bmrMifflin(176.37, 180, 30, 'male')).toBeCloseTo(1780, 0)
  })
  it('uses the female offset', () => {
    expect(bmrMifflin(176.37, 180, 30, 'female')).toBeCloseTo(1614, 0)
  })
})

describe('tdee', () => {
  it('multiplies BMR by the activity factor', () => {
    expect(tdee(2000, 'sedentary')).toBeCloseTo(2400, 5)
    expect(tdee(2000, 'very_active')).toBeCloseTo(3800, 5)
  })
})

describe('caloriesForRate', () => {
  it('spreads ~3500 kcal/lb across a week', () => {
    expect(caloriesForRate(1)).toBeCloseTo(500, 5)
    expect(caloriesForRate(-1)).toBeCloseTo(-500, 5)
    expect(caloriesForRate(0)).toBe(0)
  })
})

describe('resolveCalorieGoal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 26, 12, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const calculatedProfile = {
    sex: 'male' as const,
    birth_date: '1996-06-26',
    height_cm: 180,
    activity_level: 'moderate' as const,
    goal_rate_lb_per_week: 0,
    calorie_goal_mode: 'calculated' as const,
    manual_calorie_goal: null,
  }

  it('computes a calculated goal from a complete profile', () => {
    const r = resolveCalorieGoal(calculatedProfile, 176.37)
    expect(r.bmr).toBe(1780)
    expect(r.tdee).toBe(2759)
    expect(r.calculated).toBe(2759)
    expect(r.goal).toBe(2759)
    expect(r.missing).toEqual([])
  })

  it('applies the weekly rate as a deficit/surplus', () => {
    const r = resolveCalorieGoal(
      { ...calculatedProfile, goal_rate_lb_per_week: -1 },
      176.37,
    )
    expect(r.goal).toBe(2259) // 2759 - 500
  })

  it('honours a manual override', () => {
    const r = resolveCalorieGoal(
      {
        ...calculatedProfile,
        calorie_goal_mode: 'manual',
        manual_calorie_goal: 2100,
      },
      176.37,
    )
    expect(r.goal).toBe(2100)
    expect(r.calculated).toBe(2759) // still surfaces the suggestion
  })

  it('falls back to calculated when manual mode has no number', () => {
    const r = resolveCalorieGoal(
      { ...calculatedProfile, calorie_goal_mode: 'manual', manual_calorie_goal: null },
      176.37,
    )
    expect(r.goal).toBe(2759)
  })

  it('reports the missing fields and yields no goal', () => {
    const r = resolveCalorieGoal(
      {
        sex: null,
        birth_date: null,
        height_cm: null,
        activity_level: 'sedentary',
        goal_rate_lb_per_week: 0,
        calorie_goal_mode: 'calculated',
        manual_calorie_goal: null,
      },
      null,
    )
    expect(r.missing).toEqual(['sex', 'birth date', 'height', 'current weight'])
    expect(r.calculated).toBeNull()
    expect(r.goal).toBeNull()
    expect(r.bmr).toBeNull()
  })
})

describe('goalForDate', () => {
  const history = [
    { from: GOAL_HISTORY_BASELINE_DATE, goal: 2000 },
    { from: '2026-07-10', goal: 1800 },
  ]
  const today = '2026-07-19'

  it('uses the live goal for today and future days', () => {
    expect(goalForDate(history, today, 1700, today)).toBe(1700)
    expect(goalForDate(history, '2026-08-01', 1700, today)).toBe(1700)
  })

  it('uses the goal that was in effect on a past day', () => {
    expect(goalForDate(history, '2026-07-05', 1700, today)).toBe(2000)
    expect(goalForDate(history, '2026-07-15', 1700, today)).toBe(1800)
  })

  it('falls back to the live goal when there is no history', () => {
    expect(goalForDate([], '2026-07-05', 1700, today)).toBe(1700)
    expect(goalForDate(null, '2026-07-05', 1700, today)).toBe(1700)
  })
})

describe('recordGoalChange', () => {
  const today = '2026-07-19'

  it('seeds a baseline plus today on the first change', () => {
    expect(recordGoalChange([], { today, oldGoal: 2000, newGoal: 1800 })).toEqual([
      { from: GOAL_HISTORY_BASELINE_DATE, goal: 2000 },
      { from: today, goal: 1800 },
    ])
  })

  it('is a no-op when the goal is unchanged', () => {
    expect(recordGoalChange([], { today, oldGoal: 2000, newGoal: 2000 })).toEqual([])
    const seeded = [
      { from: GOAL_HISTORY_BASELINE_DATE, goal: 2000 },
      { from: '2026-07-10', goal: 1800 },
    ]
    // Effective goal today is 1800; re-saving 1800 records nothing new.
    expect(
      recordGoalChange(seeded, { today, oldGoal: 1800, newGoal: 1800 }),
    ).toEqual(seeded)
  })

  it('appends later changes without a new baseline', () => {
    const first = recordGoalChange([], {
      today: '2026-07-10',
      oldGoal: 2000,
      newGoal: 1800,
    })
    const second = recordGoalChange(first, { today, oldGoal: 1800, newGoal: 1700 })
    expect(second).toEqual([
      { from: GOAL_HISTORY_BASELINE_DATE, goal: 2000 },
      { from: '2026-07-10', goal: 1800 },
      { from: today, goal: 1700 },
    ])
  })

  it('upserts a second change on the same day', () => {
    const first = recordGoalChange([], { today, oldGoal: 2000, newGoal: 1800 })
    const again = recordGoalChange(first, { today, oldGoal: 1800, newGoal: 1700 })
    expect(again).toEqual([
      { from: GOAL_HISTORY_BASELINE_DATE, goal: 2000 },
      { from: today, goal: 1700 },
    ])
  })

  it('records nothing when there is no computable new goal', () => {
    expect(recordGoalChange([], { today, oldGoal: 2000, newGoal: null })).toEqual([])
  })

  it('keeps past days put after a change while today stays live', () => {
    const h = recordGoalChange([], { today, oldGoal: 2000, newGoal: 1800 })
    expect(goalForDate(h, '2026-07-01', 1800, today)).toBe(2000)
    expect(goalForDate(h, today, 1800, today)).toBe(1800)
  })
})

describe('estimateAdaptiveTDEE', () => {
  const weights = [
    { date: '2026-06-01', value: 200 },
    { date: '2026-06-29', value: 198 },
  ]

  it('needs at least two weigh-ins', () => {
    const r = estimateAdaptiveTDEE([], [{ date: '2026-06-01', value: 200 }])
    expect(r.enough).toBe(false)
    expect(r.reason).toMatch(/two weigh-ins/i)
  })

  it('needs ~2 weeks of span', () => {
    const r = estimateAdaptiveTDEE([], [
      { date: '2026-06-01', value: 200 },
      { date: '2026-06-10', value: 199 },
    ])
    expect(r.enough).toBe(false)
    expect(r.spanDays).toBe(9)
    expect(r.reason).toMatch(/2 weeks/i)
  })

  it('needs enough logged days', () => {
    const intake = [1, 2, 3, 4, 5].map((i) => ({
      date: `2026-06-0${i}`,
      kcal: 2000,
    }))
    const r = estimateAdaptiveTDEE(intake, weights)
    expect(r.enough).toBe(false)
    expect(r.loggedDays).toBe(5)
    expect(r.reason).toMatch(/keep logging/i)
  })

  it('derives maintenance from intake minus the weight trend', () => {
    const intake = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, '0')}`,
      kcal: 2000,
    }))
    intake.push({ date: '2026-06-15', kcal: 300 }) // below threshold, ignored

    const r = estimateAdaptiveTDEE(intake, weights)
    expect(r.enough).toBe(true)
    expect(r.loggedDays).toBe(14) // the 300-kcal day excluded
    expect(r.spanDays).toBe(28)
    expect(r.avgIntake).toBe(2000)
    // losing 2 lb over 28 days => +250 kcal/day back to maintenance.
    expect(r.tdee).toBe(2250)
    expect(r.trendLbPerWeek).toBeCloseTo(-0.5, 5)
  })
})

describe('resolveMacroTargets', () => {
  it('resolves gram targets to kcal and percentages', () => {
    const targets: MacroTargets = {
      protein: { mode: 'g', value: 150 },
      fat: { mode: 'g', value: 60 },
      carb: { mode: 'g', value: 200 },
    }
    const r = resolveMacroTargets(2000, 180, targets)
    expect(r.protein).toEqual({ grams: 150, kcal: 600, pct: 30 })
    expect(r.fat).toEqual({ grams: 60, kcal: 540, pct: 27 })
    expect(r.carb).toEqual({ grams: 200, kcal: 800, pct: 40 })
  })

  it('resolves g-per-lb against body weight', () => {
    const targets: MacroTargets = {
      protein: { mode: 'g_per_lb', value: 1 },
      fat: { mode: 'g', value: 60 },
      carb: { mode: 'g', value: 200 },
    }
    expect(resolveMacroTargets(2000, 180, targets).protein.grams).toBe(180)
  })

  it('resolves a percentage of calories', () => {
    const targets: MacroTargets = {
      protein: { mode: 'g', value: 150 },
      fat: { mode: 'g', value: 60 },
      carb: { mode: 'pct', value: 50 },
    }
    expect(resolveMacroTargets(2000, 180, targets).carb.grams).toBe(250)
  })

  it('fills the remainder macro from leftover calories', () => {
    const targets: MacroTargets = {
      protein: { mode: 'g', value: 150 }, // 600 kcal
      fat: { mode: 'g', value: 60 }, // 540 kcal
      carb: { mode: 'remainder' },
    }
    // leftover = 2000 - 1140 = 860 kcal => 215 g carbs
    expect(resolveMacroTargets(2000, null, targets).carb.grams).toBe(215)
  })
})

describe('estimated1RM (Epley)', () => {
  it('returns the weight itself at one rep', () => {
    expect(estimated1RM(100, 1)).toBe(100)
  })
  it('applies the Epley factor above one rep', () => {
    expect(estimated1RM(100, 5)).toBeCloseTo(116.67, 2)
  })
  it('guards against non-positive input', () => {
    expect(estimated1RM(0, 5)).toBe(0)
    expect(estimated1RM(100, 0)).toBe(0)
    expect(estimated1RM(100, -3)).toBe(0)
  })
})

describe('metCalories', () => {
  it('estimates kcal from MET, duration, and weight', () => {
    expect(metCalories(8, 30, 154)).toBe(293)
  })
  it('returns 0 when any factor is missing', () => {
    expect(metCalories(0, 30, 154)).toBe(0)
    expect(metCalories(8, 0, 154)).toBe(0)
    expect(metCalories(8, 30, 0)).toBe(0)
  })
})

describe('distanceCalories', () => {
  it('uses the running coefficient at MET >= 7', () => {
    expect(distanceCalories(5, 154, 8)).toBe(562)
  })
  it('uses the lighter coefficient below MET 7', () => {
    expect(distanceCalories(5, 154, 5)).toBe(337)
  })
  it('returns 0 without distance or weight', () => {
    expect(distanceCalories(0, 154, 8)).toBe(0)
    expect(distanceCalories(5, 0, 8)).toBe(0)
  })
})

describe('effectiveWeightLb', () => {
  it('adds the carried load to body weight', () => {
    expect(effectiveWeightLb(190, 35)).toBe(225)
  })
  it('treats a missing or negative load as unloaded', () => {
    expect(effectiveWeightLb(190, null)).toBe(190)
    expect(effectiveWeightLb(190, -10)).toBe(190)
  })
  it('stays 0 without a body weight, so estimates stay blank', () => {
    expect(effectiveWeightLb(null, 35)).toBe(0)
  })
})

describe('loaded cardio (rucking)', () => {
  // 190 lb, 30 min at rucking's unloaded 4.5 MET. Pandolf puts the same three
  // loads at 205/220/233 kcal gross, so these track it within ~10%.
  const ruck = (loadLb: number) =>
    metCalories(4.5, 30, effectiveWeightLb(190, loadLb))

  it('scales the MET burn with the load', () => {
    expect(ruck(0)).toBe(204)
    expect(ruck(20)).toBe(225)
    expect(ruck(35)).toBe(241)
    expect(ruck(50)).toBe(257)
  })

  it('keeps the walking coefficient on the distance path', () => {
    // MET 4.5 < 7, so a loaded 1.75 mi ruck is priced as a walk, not a run.
    expect(distanceCalories(1.75, effectiveWeightLb(190, 35), 4.5)).toBe(172)
  })
})

describe('levelMet', () => {
  it('anchors the bottom and top of any scale', () => {
    expect(levelMet(1, 10)).toBeCloseTo(3.5, 5)
    expect(levelMet(10, 10)).toBeCloseTo(8.9, 5)
    expect(levelMet(1, 18)).toBeCloseTo(3.5, 5)
    expect(levelMet(18, 18)).toBeCloseTo(8.9, 5)
  })

  it('makes the same effort match across different scales', () => {
    // Level 12 of 18 is 65% of max — level ~7 of 10, ~10 of 15. Coarser scales
    // can't land on it exactly (7/10 is 67%), so allow a rounding step.
    const target = levelMet(12, 18)!
    expect(target).toBeCloseTo(6.99, 2)
    expect(Math.abs(levelMet(7, 10)! - target)).toBeLessThan(0.3)
    expect(Math.abs(levelMet(10, 15)! - target)).toBeLessThan(0.3)
  })

  it('prices the same raw level differently on a longer scale', () => {
    // The whole point: "level 5" is 44% of max on a 10, but 24% on an 18.
    expect(metCalories(levelMet(5, 10)!, 20, 190)).toBe(178)
    expect(metCalories(levelMet(5, 18)!, 20, 190)).toBe(144)
  })

  it('clamps out-of-range levels instead of extrapolating', () => {
    expect(levelMet(25, 18)).toBeCloseTo(8.9, 5)
    expect(levelMet(0, 18)).toBeNull()
  })

  it('returns null when the scale is missing or unusable', () => {
    expect(levelMet(5, null)).toBeNull()
    expect(levelMet(null, 10)).toBeNull()
    expect(levelMet(5, 1)).toBeNull()
  })
})

describe('distanceCoef', () => {
  it('picks the run coefficient at or above 5 mph', () => {
    expect(distanceCoef(5)).toBe(1.0)
    expect(distanceCoef(6)).toBe(1.0)
  })
  it('picks the walk coefficient below 5 mph', () => {
    expect(distanceCoef(4.9)).toBe(0.6)
    expect(distanceCoef(3)).toBe(0.6)
  })
})

describe('paceAwareCalories', () => {
  it('burns more for the same distance at a faster pace', () => {
    // 2 mi in 20 min = 6 mph (run coef) vs 2 mi in 30 min = 4 mph (walk coef).
    expect(paceAwareCalories(2, 20, 154)).toBe(225)
    expect(paceAwareCalories(2, 30, 154)).toBe(135)
  })
  it('returns 0 without distance or weight', () => {
    expect(paceAwareCalories(0, 20, 154)).toBe(0)
    expect(paceAwareCalories(2, 20, 0)).toBe(0)
  })
})

describe('bmi', () => {
  it('computes BMI from lb and cm', () => {
    expect(bmi(kgToLb(100), 200)).toBeCloseTo(25, 5)
    expect(bmi(154, 180)).toBeCloseTo(21.56, 2)
  })
})

describe('movingAverage', () => {
  const pts = [10, 20, 30, 40, 50].map((value, i) => ({
    date: `2026-01-0${i + 1}`,
    value,
  }))

  it('computes a trailing window average', () => {
    const out = movingAverage(pts, 3)
    expect(out.map((p) => p.trend)).toEqual([10, 15, 20, 30, 40])
  })
  it('keeps the raw values alongside the trend', () => {
    const out = movingAverage(pts, 3)
    expect(out.map((p) => p.value)).toEqual([10, 20, 30, 40, 50])
  })
  it('sorts unsorted input by date first', () => {
    const shuffled = [pts[3], pts[0], pts[4], pts[1], pts[2]]
    const out = movingAverage(shuffled, 7)
    expect(out.map((p) => p.date)).toEqual(pts.map((p) => p.date))
    expect(out[4].trend).toBeCloseTo(30, 5) // avg of all 5 within a 7-day window
  })
})

describe('warmupRamp', () => {
  it('ramps a barbell lift: bar, then 50/70/90% rounded to 5', () => {
    expect(warmupRamp(185, true)).toEqual([
      { weightLb: 45, reps: 10, isBar: true },
      { weightLb: 95, reps: 5 },
      { weightLb: 130, reps: 3 },
      { weightLb: 165, reps: 1 },
    ])
  })
  it('skips the bar step for non-barbell lifts', () => {
    expect(warmupRamp(50, false)).toEqual([
      { weightLb: 25, reps: 5 },
      { weightLb: 35, reps: 3 },
      { weightLb: 45, reps: 1 },
    ])
  })
  it('drops percentage steps that fall at or below the bar', () => {
    expect(warmupRamp(95, true)).toEqual([
      { weightLb: 45, reps: 10, isBar: true },
      { weightLb: 50, reps: 5 },
      { weightLb: 65, reps: 3 },
      { weightLb: 85, reps: 1 },
    ])
    // 50% (30) and 70% (40) land under the bar; only 90% (50) survives.
    expect(warmupRamp(55, true)).toEqual([
      { weightLb: 45, reps: 10, isBar: true },
      { weightLb: 50, reps: 1 },
    ])
  })
  it('drops steps that round into the working weight or each other', () => {
    // 90% of 20 rounds to 20 = working weight → dropped.
    expect(warmupRamp(20, false)).toEqual([
      { weightLb: 10, reps: 5 },
      { weightLb: 15, reps: 3 },
    ])
    // 50% and 70% of 15 both round to 10 → deduped.
    expect(warmupRamp(15, false)).toEqual([{ weightLb: 10, reps: 5 }])
  })
  it('returns no ramp when the working weight is the bar or invalid', () => {
    expect(warmupRamp(45, true)).toEqual([])
    expect(warmupRamp(0, true)).toEqual([])
    expect(warmupRamp(NaN, false)).toEqual([])
  })
})
