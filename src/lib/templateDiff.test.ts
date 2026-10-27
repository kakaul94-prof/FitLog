import { describe, expect, it } from 'vitest'
import {
  diffTemplate,
  fmtRest,
  liftsFromWorkout,
  mergeTemplateRows,
  type LoggedExercise,
  type LoggedSet,
  type TemplateRow,
} from './templateDiff'

const ex = (
  id: string,
  key: string,
  position: number,
  superset_group: number | null = null,
): LoggedExercise => ({
  id,
  exercise_key: key,
  exercise_name: key.toUpperCase(),
  position,
  superset_group,
})

const set = (
  weId: string,
  reps: number | null,
  weight: number | null = 100,
  is_warmup = false,
): LoggedSet => ({ workout_exercise_id: weId, reps, weight_lb: weight, is_warmup })

const row = (
  key: string,
  target_sets: number | null = 3,
  target_reps: number | null = 10,
  extra: Partial<TemplateRow> = {},
): TemplateRow => ({
  exercise_key: key,
  exercise_name: key.toUpperCase(),
  target_sets,
  target_reps,
  superset_group: null,
  ...extra,
})

describe('liftsFromWorkout', () => {
  it('counts logged sets, skips warm-ups, and takes the most common reps', () => {
    const rows = liftsFromWorkout(
      [ex('a', 'bench', 0)],
      [
        set('a', 5, 135, true),
        set('a', 10),
        set('a', 8),
        set('a', 10),
        set('a', null, null),
      ],
    )
    expect(rows).toEqual([
      {
        exercise_key: 'bench',
        exercise_name: 'BENCH',
        target_sets: 3,
        target_reps: 10,
        superset_group: null,
      },
    ])
  })

  it('falls back to the blank set rows (min 1) when nothing was logged', () => {
    const rows = liftsFromWorkout(
      [ex('a', 'dips', 0), ex('b', 'rows', 1)],
      [set('a', null, null), set('a', null, null)],
    )
    expect(rows.map((r) => r.target_sets)).toEqual([2, 1])
    expect(rows[0].target_reps).toBeNull()
  })

  it('orders by position and keeps superset groups', () => {
    const rows = liftsFromWorkout(
      [ex('b', 'curl', 1, 1), ex('a', 'press', 0, 1)],
      [],
    )
    expect(rows.map((r) => r.exercise_key)).toEqual(['press', 'curl'])
    expect(rows.every((r) => r.superset_group === 1)).toBe(true)
  })

  it('weight-only sets still count as logged', () => {
    const rows = liftsFromWorkout([ex('a', 'plank', 0)], [set('a', null, 45)])
    expect(rows[0].target_sets).toBe(1)
    expect(rows[0].target_reps).toBeNull()
  })
})

describe('diffTemplate', () => {
  const tpl = [row('bench'), row('incline'), row('pulldown')]

  it('is unchanged when the workout matches the template', () => {
    const d = diffTemplate(tpl, [row('bench'), row('incline'), row('pulldown')], 90, 90)
    expect(d.changed).toBe(false)
    expect(d.added).toEqual([])
    expect(d.removed).toEqual([])
    expect(d.sets).toEqual([])
    expect(d.reordered).toBe(false)
    expect(d.rest).toBeNull()
  })

  it('reports a swap as one removed and one added', () => {
    const d = diffTemplate(tpl, [row('dips'), row('incline'), row('pulldown')], 90, 90)
    expect(d.removed).toEqual(['BENCH'])
    expect(d.added).toEqual(['DIPS'])
    expect(d.reordered).toBe(false)
    expect(d.changed).toBe(true)
  })

  it('reports set-count changes only where the template had a target', () => {
    const d = diffTemplate(
      [row('bench', 3), row('incline', null)],
      [row('bench', 4), row('incline', 5)],
      90,
      90,
    )
    expect(d.sets).toEqual([{ name: 'BENCH', from: 3, to: 4 }])
  })

  it('ignores the template warm-up and cardio rows', () => {
    const d = diffTemplate(
      [row('warmup:cat-cow', null, null), row('bench'), row('cardio:running', null, null)],
      [row('bench')],
      90,
      90,
    )
    expect(d.changed).toBe(false)
  })

  it('flags a reorder of shared lifts and a rest change', () => {
    const d = diffTemplate(tpl, [row('pulldown'), row('bench'), row('incline')], 90, 150)
    expect(d.reordered).toBe(true)
    expect(d.rest).toEqual({ from: 90, to: 150 })
    expect(d.changed).toBe(true)
  })

  it('does not call it a reorder when only the removed lift moved things', () => {
    const d = diffTemplate(tpl, [row('incline'), row('pulldown')], 90, 90)
    expect(d.reordered).toBe(false)
    expect(d.removed).toEqual(['BENCH'])
  })
})

describe('mergeTemplateRows', () => {
  it('keeps warm-up first, then the workout lifts, then cardio', () => {
    const existing = [
      row('warmup:cat-cow', null, null),
      row('bench', 3, 10, { is_optional: true }),
      row('cardio:running', null, null, { target_duration_min: 20 }),
      row('pulldown'),
    ]
    const merged = mergeTemplateRows(existing, [row('dips', 3, 8), row('bench', 4, 6)])
    expect(merged.map((r) => r.exercise_key)).toEqual([
      'warmup:cat-cow',
      'dips',
      'bench',
      'cardio:running',
    ])
    // Surviving lift keeps its time-budget flag; a new one starts core.
    expect(merged[1].is_optional).toBe(false)
    expect(merged[2].is_optional).toBe(true)
    expect(merged[2].target_sets).toBe(4)
    expect(merged[3].target_duration_min).toBe(20)
  })
})

describe('fmtRest', () => {
  it('formats m:ss', () => {
    expect(fmtRest(90)).toBe('1:30')
    expect(fmtRest(150)).toBe('2:30')
    expect(fmtRest(600)).toBe('10:00')
    expect(fmtRest(5)).toBe('0:05')
  })
})
