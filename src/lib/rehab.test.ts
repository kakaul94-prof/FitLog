import { describe, expect, it } from 'vitest'
import {
  flagsForInjury,
  formatPain,
  injuriesWarningFor,
  injuryDay,
  injuryLabel,
  isPaired,
  painMatchesInjury,
  painTrend,
  parsePain,
  pruneLog,
  recordCheckin,
  rehabWeek,
  summarizeFlags,
  type PainFlag,
} from './rehab'
import type { Injury, RehabLogEntry, RehabState } from './database.types'

const injury = (over: Partial<Injury> = {}): Injury => ({
  id: 'i1',
  site: 'shoulder',
  side: 'left',
  note: null,
  started: '2026-09-01',
  status: 'active',
  resolved: null,
  aggravates: [],
  plan: [],
  ...over,
})

describe('parsePain / formatPain', () => {
  it('splits a sided value', () => {
    expect(parsePain('left shoulder')).toEqual({ site: 'shoulder', side: 'left' })
    expect(parsePain('both knee')).toEqual({ site: 'knee', side: 'both' })
  })

  it('reads a legacy side-less value as "not recorded", not "both"', () => {
    expect(parsePain('shoulder')).toEqual({ site: 'shoulder', side: null })
  })

  it('does not mistake a multi-word site for a side', () => {
    expect(parsePain('low back')).toEqual({ site: 'low back', side: null })
    expect(parsePain('right low back')).toEqual({
      site: 'low back',
      side: 'right',
    })
  })

  it('round-trips', () => {
    expect(formatPain('shoulder', 'left')).toBe('left shoulder')
    expect(formatPain('low back', null)).toBe('low back')
    expect(parsePain(formatPain('knee', 'right'))).toEqual({
      site: 'knee',
      side: 'right',
    })
  })

  it('only pairs the joints that come in pairs', () => {
    expect(isPaired('shoulder')).toBe(true)
    expect(isPaired('low back')).toBe(false)
    expect(isPaired('other')).toBe(false)
  })
})

describe('painMatchesInjury', () => {
  const left = injury({ side: 'left' })

  it('matches the same side', () => {
    expect(painMatchesInjury('left shoulder', left)).toBe(true)
  })

  it('rejects the other side', () => {
    expect(painMatchesInjury('right shoulder', left)).toBe(false)
  })

  it('rejects a different site', () => {
    expect(painMatchesInjury('left knee', left)).toBe(false)
  })

  it('counts a side-less flag — same joint, side simply unknown', () => {
    expect(painMatchesInjury('shoulder', left)).toBe(true)
  })

  it('counts "both"', () => {
    expect(painMatchesInjury('both shoulder', left)).toBe(true)
  })
})

describe('injuryDay', () => {
  it('starts at day 1, not day 0', () => {
    expect(injuryDay(injury({ started: '2026-09-20' }), '2026-09-20')).toBe(1)
  })

  it('counts through to today while active', () => {
    expect(injuryDay(injury({ started: '2026-09-01' }), '2026-09-20')).toBe(20)
  })

  it('freezes at the resolved date once closed', () => {
    const inj = injury({
      started: '2026-09-01',
      status: 'resolved',
      resolved: '2026-09-10',
    })
    expect(injuryDay(inj, '2026-09-20')).toBe(10)
  })
})

describe('injuryLabel', () => {
  it('reads as a body part', () => {
    expect(injuryLabel(injury())).toBe('Left shoulder')
    expect(injuryLabel(injury({ site: 'low back', side: null }))).toBe('Low back')
  })
})

describe('rehabWeek', () => {
  // 2026-09-20 is a Sunday, so its week runs from Monday 2026-09-14.
  const inj = injury({
    plan: [
      { id: 'a', name: 'External rotation', targetPerWeek: 3 },
      { id: 'b', name: 'Scap pull-up', targetPerWeek: 2 },
    ],
  })
  const entry = (itemId: string, date: string, id: string): RehabLogEntry => ({
    id,
    injuryId: 'i1',
    itemId,
    date,
  })

  it('counts sessions in the current week only', () => {
    const log = [
      entry('a', '2026-09-15', 'l1'),
      entry('a', '2026-09-17', 'l2'),
      entry('a', '2026-09-10', 'l3'), // last week
    ]
    const w = rehabWeek(inj, log, '2026-09-20')
    expect(w.rows[0].done).toBe(2)
    expect(w.rows[0].complete).toBe(false)
  })

  it('completes a row at its target and clamps the bar', () => {
    const log = [
      entry('b', '2026-09-15', 'l1'),
      entry('b', '2026-09-16', 'l2'),
      entry('b', '2026-09-17', 'l3'), // one past target
    ]
    const w = rehabWeek(inj, log, '2026-09-20')
    expect(w.rows[1].complete).toBe(true)
    expect(w.rows[1].progress).toBe(1)
  })

  it('ignores another injury’s log', () => {
    const log = [{ ...entry('a', '2026-09-15', 'l1'), injuryId: 'other' }]
    expect(rehabWeek(inj, log, '2026-09-20').rows[0].done).toBe(0)
  })

  it('rolls the plan up', () => {
    const log = [
      entry('a', '2026-09-15', 'l1'),
      entry('a', '2026-09-16', 'l2'),
      entry('a', '2026-09-17', 'l3'),
    ]
    const w = rehabWeek(inj, log, '2026-09-20')
    expect(w.doneCount).toBe(1)
    expect(w.targetCount).toBe(2)
    expect(w.progress).toBe(0.5)
  })

  it('has no progress to show for an empty plan', () => {
    expect(rehabWeek(injury(), [], '2026-09-20').progress).toBe(0)
  })
})

describe('recordCheckin', () => {
  const base: RehabState = { injuries: [injury()], log: [], checkins: [] }

  it('clamps to 0-10 and rounds', () => {
    const s = recordCheckin(base, 'i1', '2026-09-20', 12.4, 'c1')
    expect(s.checkins[0].pain).toBe(10)
    expect(recordCheckin(base, 'i1', '2026-09-20', -3, 'c2').checkins[0].pain).toBe(0)
  })

  it('replaces an earlier rating for the same day', () => {
    let s = recordCheckin(base, 'i1', '2026-09-20', 6, 'c1')
    s = recordCheckin(s, 'i1', '2026-09-20', 4, 'c2')
    expect(s.checkins).toHaveLength(1)
    expect(s.checkins[0].pain).toBe(4)
  })

  it('keeps other days and other injuries', () => {
    let s = recordCheckin(base, 'i1', '2026-09-19', 6, 'c1')
    s = recordCheckin(s, 'i2', '2026-09-19', 2, 'c2')
    s = recordCheckin(s, 'i1', '2026-09-20', 4, 'c3')
    expect(s.checkins).toHaveLength(3)
  })
})

describe('painTrend', () => {
  const state = (pairs: [string, number][]): RehabState => ({
    injuries: [injury()],
    log: [],
    checkins: pairs.map(([date, pain], i) => ({
      id: `c${i}`,
      injuryId: 'i1',
      date,
      pain,
    })),
  })

  it('reports nothing without a check-in', () => {
    expect(painTrend([], 'i1').delta).toBeNull()
  })

  it('has no delta from a single point', () => {
    const t = painTrend(state([['2026-09-20', 5]]).checkins, 'i1')
    expect(t.latest).toBe(5)
    expect(t.delta).toBeNull()
  })

  it('is negative while improving, regardless of insertion order', () => {
    const t = painTrend(
      state([
        ['2026-09-20', 3],
        ['2026-09-01', 6],
      ]).checkins,
      'i1',
    )
    expect(t.first).toBe(6)
    expect(t.latest).toBe(3)
    expect(t.delta).toBe(-3)
    expect(t.days).toBe(19)
  })
})

describe('summarizeFlags', () => {
  const flag = (
    pain: string,
    date: string,
    name = 'Bench Press',
    key = 'bench_press',
  ): PainFlag => ({ pain, date, exerciseKey: key, exerciseName: name })

  it('groups by site, ignoring side', () => {
    const out = summarizeFlags([
      flag('left shoulder', '2026-09-10'),
      flag('right shoulder', '2026-09-12'),
      flag('knee', '2026-09-01', 'Back Squat', 'back_squat'),
    ])
    expect(out[0].site).toBe('shoulder')
    expect(out[0].count).toBe(2)
    expect(out[0].left).toBe(1)
    expect(out[0].right).toBe(1)
  })

  it('counts legacy flags as "side not recorded"', () => {
    const out = summarizeFlags([flag('shoulder', '2026-09-10')])
    expect(out[0].unknown).toBe(1)
    expect(out[0].both).toBe(0)
  })

  it('reports the newest flag as "last"', () => {
    const out = summarizeFlags([
      flag('left shoulder', '2026-09-01'),
      flag('left shoulder', '2026-09-14', 'Overhead Press', 'overhead_press'),
    ])
    expect(out[0].last.date).toBe('2026-09-14')
    expect(out[0].last.exerciseName).toBe('Overhead Press')
  })

  it('ranks the exercises that caused them', () => {
    const out = summarizeFlags([
      flag('left shoulder', '2026-09-01'),
      flag('left shoulder', '2026-09-02'),
      flag('left shoulder', '2026-09-03', 'Overhead Press', 'overhead_press'),
    ])
    expect(out[0].topExercises[0]).toMatchObject({ name: 'Bench Press', count: 2 })
  })
})

describe('flagsForInjury', () => {
  const flags: PainFlag[] = [
    { pain: 'left shoulder', date: '2026-09-14', exerciseKey: 'k', exerciseName: 'Bench' },
    { pain: 'right shoulder', date: '2026-09-15', exerciseKey: 'k', exerciseName: 'Bench' },
    { pain: 'left shoulder', date: '2026-01-01', exerciseKey: 'k', exerciseName: 'Bench' },
  ]

  it('keeps only this joint, inside the window', () => {
    const out = flagsForInjury(flags, injury({ side: 'left' }), '2026-09-20', 90)
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-09-14')
  })
})

describe('injuriesWarningFor', () => {
  it('only warns for open injuries that name the lift', () => {
    const state: RehabState = {
      injuries: [
        injury({ id: 'a', aggravates: ['bench_press'] }),
        injury({ id: 'b', aggravates: ['bench_press'], status: 'resolved' }),
        injury({ id: 'c', aggravates: ['back_squat'] }),
      ],
      log: [],
      checkins: [],
    }
    expect(injuriesWarningFor(state, 'bench_press').map((i) => i.id)).toEqual(['a'])
  })
})

describe('pruneLog', () => {
  it('drops entries past the retention window but keeps a months-old arc', () => {
    const log: RehabLogEntry[] = [
      { id: '1', injuryId: 'i1', itemId: 'a', date: '2026-06-01' },
      { id: '2', injuryId: 'i1', itemId: 'a', date: '2024-01-01' },
    ]
    const out = pruneLog(log, '2026-09-20')
    expect(out.map((e) => e.id)).toEqual(['1'])
  })
})
