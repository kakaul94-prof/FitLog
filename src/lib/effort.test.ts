import { describe, expect, it } from 'vitest'
import {
  effortName,
  effortOptionValue,
  effortOptions,
  effortText,
  effortValue,
} from './effort'

describe('effort scale', () => {
  it('maps RPE to reps in reserve (RIR = 10 − RPE)', () => {
    expect(effortValue(10, 'rir')).toBe('0')
    expect(effortValue(9, 'rir')).toBe('1')
    expect(effortValue(7, 'rir')).toBe('3')
    expect(effortValue(6, 'rir')).toBe('4')
  })

  it('collapses RPE 5 and below into 5+ RIR', () => {
    expect(effortValue(5, 'rir')).toBe('5+')
    expect(effortValue(1, 'rir')).toBe('5+')
  })

  it('leaves RPE as-is in RPE mode', () => {
    expect(effortValue(8, 'rpe')).toBe('8')
    expect(effortText(8, 'rpe')).toBe('RPE 8')
    expect(effortName('rpe')).toBe('RPE')
  })

  it('writes inline text in the chosen scale only', () => {
    expect(effortText(8, 'rir')).toBe('2 RIR')
    expect(effortText(3, 'rir')).toBe('5+ RIR')
    expect(effortName('rir')).toBe('RIR')
  })

  it('offers 1–10 for RPE and 0–5+ for RIR, storing RPE', () => {
    expect(effortOptions('rpe').map((o) => o.value)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ])
    expect(effortOptions('rir')).toEqual([
      { value: 10, label: '0' },
      { value: 9, label: '1' },
      { value: 8, label: '2' },
      { value: 7, label: '3' },
      { value: 6, label: '4' },
      { value: 5, label: '5+' },
    ])
  })

  it('selects the 5+ option for old low-RPE sets in RIR mode', () => {
    expect(effortOptionValue(3, 'rir')).toBe(5)
    expect(effortOptionValue(8, 'rir')).toBe(8)
    expect(effortOptionValue(3, 'rpe')).toBe(3)
  })
})
