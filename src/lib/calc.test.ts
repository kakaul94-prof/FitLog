import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ageFromBirthDate,
  bmi,
  bmrMifflin,
  caloriesForRate,
  cmToFtIn,
  distanceCalories,
  estimateAdaptiveTDEE,
  estimated1RM,
  ftInToCm,
  hrMax,
  hrZones,
  kgToLb,
  lbToKg,
  metCalories,
  movingAverage,
  resolveCalorieGoal,
  resolveMacroTargets,
  roundHalf,
  tdee,
  zoneForHr,
} from './calc'
import type { MacroTargets } from './database.types'

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
  it('derives 5 bpm zone ranges from age', () => {
    const z = hrZones(30) // max 187
    expect(z).toHaveLength(5)
    expect(z[0]).toMatchObject({ zone: 1, loBpm: 94, hiBpm: 112 })
    expect(z[4]).toMatchObject({ zone: 5, loBpm: 168, hiBpm: 187 })
  })
  it('maps an average HR to its zone', () => {
    const age = 30 // max 187
    expect(zoneForHr(90, age)).toBeNull() // <50% max
    expect(zoneForHr(100, age)).toBe(1)
    expect(zoneForHr(138, age)).toBe(3)
    expect(zoneForHr(180, age)).toBe(5)
    expect(zoneForHr(0, age)).toBeNull()
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
