import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDaysISO, dateLabel, daysBetweenISO, timeLabel, todayISO } from './date'

describe('todayISO', () => {
  it('formats a passed date as zero-padded YYYY-MM-DD', () => {
    expect(todayISO(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
  it('keeps two-digit months and days intact', () => {
    expect(todayISO(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('addDaysISO', () => {
  it('adds days within a month', () => {
    expect(addDaysISO('2026-06-10', 5)).toBe('2026-06-15')
  })
  it('rolls forward over a month boundary', () => {
    expect(addDaysISO('2026-01-31', 1)).toBe('2026-02-01')
  })
  it('rolls back over a month boundary with a negative delta', () => {
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('lands on Feb 29 in a leap year', () => {
    expect(addDaysISO('2024-02-28', 1)).toBe('2024-02-29')
  })
  it('skips Feb 29 in a non-leap year', () => {
    expect(addDaysISO('2026-02-28', 1)).toBe('2026-03-01')
  })
  it('rolls over a year boundary', () => {
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('is reversible', () => {
    expect(addDaysISO(addDaysISO('2026-06-26', 40), -40)).toBe('2026-06-26')
  })
})

describe('daysBetweenISO', () => {
  it('counts whole days forward', () => {
    expect(daysBetweenISO('2026-01-01', '2026-01-31')).toBe(30)
  })
  it('is negative when the end precedes the start', () => {
    expect(daysBetweenISO('2026-01-31', '2026-01-01')).toBe(-30)
  })
  it('is zero for the same day', () => {
    expect(daysBetweenISO('2026-06-26', '2026-06-26')).toBe(0)
  })
  it('counts across a year boundary', () => {
    expect(daysBetweenISO('2026-12-31', '2027-01-01')).toBe(1)
  })
})

describe('dateLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 26, 12, 0, 0)) // 2026-06-26, local noon
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('labels the relative days', () => {
    expect(dateLabel('2026-06-26')).toBe('Today')
    expect(dateLabel('2026-06-25')).toBe('Yesterday')
    expect(dateLabel('2026-06-27')).toBe('Tomorrow')
  })
  it('formats other days without the relative words', () => {
    const label = dateLabel('2026-01-01')
    expect(label).not.toMatch(/Today|Yesterday|Tomorrow/)
    expect(label.length).toBeGreaterThan(0)
  })
})

describe('timeLabel', () => {
  // Locale-agnostic: a 12h locale yields "3:45p", a 24h locale "15:45". Either
  // way it has a colon and no upper-case meridiem after the transform.
  it('keeps a colon and lower-cases any meridiem', () => {
    const label = timeLabel('2026-06-26T15:45:00')
    expect(label).toContain(':')
    expect(label).not.toMatch(/[AP]M/)
  })
})
