import { describe, expect, it } from 'vitest'
import {
  buildReport,
  canGoForward,
  coveredEnd,
  fmtSteps,
  lastCompletedPeriod,
  onPace,
  periodBuckets,
  periodContaining,
  scoreBand,
  scoreFloor,
  shiftPeriod,
  type ReportDay,
  type ReportInput,
} from './report'
import { addDaysISO } from './date'

describe('periods', () => {
  it('weeks run Monday–Sunday', () => {
    expect(periodContaining('week', '2026-09-10')).toEqual({
      kind: 'week',
      start: '2026-09-07',
      end: '2026-09-13',
    })
    expect(periodContaining('week', '2026-09-13').start).toBe('2026-09-07')
    expect(periodContaining('week', '2026-09-14').start).toBe('2026-09-14')
  })

  it('months cover the whole calendar month, leap years included', () => {
    expect(periodContaining('month', '2026-02-15')).toEqual({
      kind: 'month',
      start: '2026-02-01',
      end: '2026-02-28',
    })
    expect(periodContaining('month', '2028-02-03').end).toBe('2028-02-29')
    expect(periodContaining('month', '2026-12-31').start).toBe('2026-12-01')
  })

  it('opens on the last fully completed period', () => {
    // 2026-09-14 is a Monday: the week just ended is Sep 7–13.
    expect(lastCompletedPeriod('week', '2026-09-14').start).toBe('2026-09-07')
    expect(lastCompletedPeriod('week', '2026-09-13').start).toBe('2026-08-31')
    expect(lastCompletedPeriod('month', '2026-09-14')).toMatchObject({
      start: '2026-08-01',
      end: '2026-08-31',
    })
  })

  it('shifts across month and year boundaries', () => {
    const dec = periodContaining('month', '2026-12-10')
    expect(shiftPeriod(dec, 1).start).toBe('2027-01-01')
    expect(shiftPeriod(dec, -1).end).toBe('2026-11-30')
    expect(shiftPeriod(periodContaining('week', '2026-09-01'), -1).start).toBe('2026-08-24')
  })

  it('stops going forward at the period in progress', () => {
    const today = '2026-09-16'
    expect(canGoForward(lastCompletedPeriod('week', today), today)).toBe(true)
    const current = periodContaining('week', today)
    expect(canGoForward(current, today)).toBe(false)
    expect(coveredEnd(current, today)).toBe(today)
  })

  it('buckets a week by day and a month by Monday-week', () => {
    expect(periodBuckets(periodContaining('week', '2026-09-10')).map((b) => b.label)).toEqual(
      ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
    )
    // Sep 2026 starts on a Tuesday.
    expect(periodBuckets(periodContaining('month', '2026-09-10')).map((b) => b.label)).toEqual(
      ['1–6', '7–13', '14–20', '21–27', '28–30'],
    )
  })
})

describe('scoring', () => {
  it('scores floor goals at 95% hit / 80% close', () => {
    expect(scoreFloor(95, 100)).toBe('hit')
    expect(scoreFloor(94, 100)).toBe('close')
    expect(scoreFloor(80, 100)).toBe('close')
    expect(scoreFloor(79, 100)).toBe('miss')
    expect(scoreFloor(0, 0)).toBe('hit')
  })

  it('scores calories two-sided: over the band is a miss, a little under is close', () => {
    expect(scoreBand(1100, 1000)).toBe('hit')
    expect(scoreBand(1101, 1000)).toBe('miss')
    expect(scoreBand(900, 1000)).toBe('hit')
    expect(scoreBand(899, 1000)).toBe('close')
    expect(scoreBand(749, 1000)).toBe('miss')
  })

  it('counts weight pace within a quarter pound a week', () => {
    expect(onPace(-0.9, -1)).toBe(true)
    expect(onPace(-0.7, -1)).toBe(false)
  })

  it('formats steps compactly', () => {
    expect(fmtSteps(840)).toBe('840')
    expect(fmtSteps(8400)).toBe('8.4k')
    expect(fmtSteps(10000)).toBe('10k')
  })
})

const WEEK = periodContaining('week', '2026-09-07')
const AFTER_WEEK = '2026-09-20'

function day(i: number, over: Partial<ReportDay> = {}): ReportDay {
  return {
    date: addDaysISO(WEEK.start, i),
    logged: true,
    kcal: 800,
    protein: 170,
    burned: 0,
    calorieGoal: 800,
    proteinTarget: 170,
    cardioMin: 0,
    workouts: 0,
    mobilitySec: 0,
    steps: null,
    ...over,
  }
}

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    period: WEEK,
    today: AFTER_WEEK,
    days: Array.from({ length: 7 }, (_, i) => day(i)),
    cardioWeeklyMin: null,
    stepGoal: null,
    mobilityWeeklySec: 0,
    muscles: [],
    ...over,
  }
}

describe('buildReport', () => {
  it('surfaces misses first and names them in the headline', () => {
    const r = buildReport(
      input({
        days: Array.from({ length: 7 }, (_, i) => day(i, { protein: 120 })),
        cardioWeeklyMin: 150,
        mobilityWeeklySec: 3600,
      }),
    )
    expect(r.goals.map((g) => g.key)).toEqual(['protein', 'cardio', 'mobility', 'calories'])
    expect(r.met).toBe(1)
    expect(r.missed).toEqual(['Protein', 'Cardio', 'Mobility'])
    expect(r.goals[0].note).toBe('50 g short')
  })

  it('scores calories net of exercise burn', () => {
    // 1,000 eaten − 200 burned = 800 net, exactly the goal.
    const r = buildReport(input({ days: [day(0, { kcal: 1000, burned: 200 })] }))
    const cal = r.goals.find((g) => g.key === 'calories')
    expect(cal?.status).toBe('hit')
    expect(cal?.note).toBe('in range')
  })

  it('only averages food goals over logged days', () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      i < 4 ? day(i) : day(i, { logged: false, kcal: 0, protein: 0 }),
    )
    const r = buildReport(input({ days }))
    expect(r.goals.find((g) => g.key === 'protein')?.status).toBe('hit')
    expect(r.loggedDays).toBe(4)
    expect(r.lowCoverage).toBe(true)
    expect(r.goals.find((g) => g.key === 'protein')?.cells[5]).toEqual({
      label: 'S',
      value: '—',
      tone: 'none',
    })
  })

  it('hides steps when Health Connect returned nothing', () => {
    expect(buildReport(input({ stepGoal: 10000 })).goals.some((g) => g.key === 'steps')).toBe(
      false,
    )
    const r = buildReport(
      input({ stepGoal: 10000, days: [day(0, { steps: 8400 }), day(1, { steps: 8400 })] }),
    )
    expect(r.goals.find((g) => g.key === 'steps')).toMatchObject({
      value: '8.4k',
      status: 'close',
      note: '1.6k short',
    })
  })

  it('pro-rates weekly targets to the days covered so far', () => {
    // Wednesday of the current week: 3 days covered → 150 × 3/7 ≈ 64 min.
    const r = buildReport(
      input({
        today: addDaysISO(WEEK.start, 2),
        days: [day(0), day(1, { cardioMin: 65 }), day(2)],
        cardioWeeklyMin: 150,
      }),
    )
    const c = r.goals.find((g) => g.key === 'cardio')
    expect(c?.status).toBe('hit')
    expect(c?.target).toBe('/ 64 min')
    expect(c?.cells[6]).toEqual({ label: 'S', value: '', tone: 'none' })
  })

  it('lists the muscles under their weekly set target', () => {
    const r = buildReport(
      input({
        muscles: [
          { label: 'Chest', sets: 12, weeklyGoal: 10 },
          { label: 'Hamstrings', sets: 4, weeklyGoal: 10 },
          { label: 'Calves', sets: 8, weeklyGoal: 10 },
        ],
      }),
    )
    const s = r.goals.find((g) => g.key === 'strength')
    expect(s).toMatchObject({ value: '1', target: '/ 3 muscles', status: 'miss' })
    expect(s?.note).toBe('hamstrings, calves low')
  })

  it('buckets a month into Monday-weeks for the detail row', () => {
    const month = periodContaining('month', '2026-09-01')
    const days = Array.from({ length: 30 }, (_, i) => ({
      ...day(0),
      date: addDaysISO(month.start, i),
      cardioMin: 30,
    }))
    const r = buildReport(input({ period: month, today: '2026-10-05', days, cardioWeeklyMin: 150 }))
    const c = r.goals.find((g) => g.key === 'cardio')
    expect(c?.cells.map((x) => x.label)).toEqual(['1–6', '7–13', '14–20', '21–27', '28–30'])
    // 30 min a day comfortably beats 150/wk in every week.
    expect(c?.cells.every((x) => x.tone === 'hit')).toBe(true)
  })

  it('returns no goals when nothing is set up', () => {
    const r = buildReport(
      input({ days: Array.from({ length: 7 }, (_, i) => day(i, { calorieGoal: null, proteinTarget: null })) }),
    )
    expect(r.goals).toEqual([])
    expect(r.met).toBe(0)
  })
})
