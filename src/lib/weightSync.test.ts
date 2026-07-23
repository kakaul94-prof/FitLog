import { describe, expect, it } from 'vitest'
import { kgToLb, maxRecordTime, planWeightInserts, type HCWeightRecord } from './weightSync'

const rec = (date: string, kg: number, time: string): HCWeightRecord => ({
  date,
  kg,
  time,
  id: `${date}-${time}`,
  origin: 'com.example.scale',
})

describe('kgToLb', () => {
  it('converts and rounds to 0.1 lb', () => {
    expect(kgToLb(70)).toBe(154.3)
    expect(kgToLb(90.7185)).toBe(200)
    expect(kgToLb(0.045359237)).toBe(0.1)
  })
})

describe('planWeightInserts', () => {
  it('returns one row per day in lb', () => {
    const out = planWeightInserts(
      [rec('2026-07-20', 90, '2026-07-20T12:00:00Z'), rec('2026-07-21', 89.5, '2026-07-21T12:00:00Z')],
      new Set(),
    )
    expect(out).toEqual([
      { measured_on: '2026-07-20', value: 198.4 },
      { measured_on: '2026-07-21', value: 197.3 },
    ])
  })

  it('keeps only the latest reading on a multi-reading day', () => {
    const out = planWeightInserts(
      [
        rec('2026-07-20', 91, '2026-07-20T07:00:00Z'),
        rec('2026-07-20', 90, '2026-07-20T21:00:00Z'),
        rec('2026-07-20', 92, '2026-07-20T12:00:00Z'),
      ],
      new Set(),
    )
    expect(out).toEqual([{ measured_on: '2026-07-20', value: kgToLb(90) }])
  })

  it('skips days that already have a weight row', () => {
    const out = planWeightInserts(
      [rec('2026-07-20', 90, '2026-07-20T12:00:00Z'), rec('2026-07-21', 89, '2026-07-21T12:00:00Z')],
      new Set(['2026-07-20']),
    )
    expect(out).toEqual([{ measured_on: '2026-07-21', value: kgToLb(89) }])
  })

  it('sorts by date and drops junk records', () => {
    const out = planWeightInserts(
      [
        rec('2026-07-22', 88, '2026-07-22T12:00:00Z'),
        rec('2026-07-20', 90, '2026-07-20T12:00:00Z'),
        rec('2026-07-21', 0, '2026-07-21T12:00:00Z'),
        rec('', 89, '2026-07-19T12:00:00Z'),
        rec('2026-07-18', NaN, '2026-07-18T12:00:00Z'),
      ],
      new Set(),
    )
    expect(out.map((r) => r.measured_on)).toEqual(['2026-07-20', '2026-07-22'])
  })

  it('handles empty input', () => {
    expect(planWeightInserts([], new Set())).toEqual([])
  })
})

describe('maxRecordTime', () => {
  it('returns the latest instant', () => {
    expect(
      maxRecordTime([
        rec('2026-07-20', 90, '2026-07-20T21:00:00Z'),
        rec('2026-07-21', 89, '2026-07-21T07:30:00Z'),
        rec('2026-07-20', 91, '2026-07-20T07:00:00Z'),
      ]),
    ).toBe('2026-07-21T07:30:00Z')
  })

  it('returns null for no records', () => {
    expect(maxRecordTime([])).toBeNull()
  })
})
