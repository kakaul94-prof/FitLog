import { afterEach, describe, expect, it, vi } from 'vitest'
import { restoreBackup, validateBackup } from './importData'

// Record the supabase calls restoreBackup makes so we can assert FK-safe order
// and the user_id forcing without a real backend. (vi.hoisted so the mock
// factory below — which Vitest hoists above the import — can see `ops`.)
const { ops } = vi.hoisted(() => ({
  ops: [] as {
    op: 'delete' | 'insert' | 'upsert'
    table: string
    rows?: unknown[]
  }[],
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      delete: () => ({
        not: () => {
          ops.push({ op: 'delete', table })
          return Promise.resolve({ error: null })
        },
      }),
      upsert: (row: unknown) => {
        ops.push({ op: 'upsert', table, rows: [row] })
        return Promise.resolve({ error: null })
      },
      insert: (chunk: unknown[]) => {
        ops.push({ op: 'insert', table, rows: chunk })
        return Promise.resolve({ error: null })
      },
    }),
  },
}))

afterEach(() => {
  ops.length = 0
})

describe('validateBackup', () => {
  it('parses a FitLog backup, keeping only known tables with counts', () => {
    const text = JSON.stringify({
      app: 'FitLog',
      exported_at: '2026-06-29T00:00:00.000Z',
      foods: [{ id: 'f1' }, { id: 'f2' }],
      measurements: [{ id: 'm1' }],
      bogus_table: [{ id: 'x' }], // unknown table -> dropped
    })
    const { data, counts } = validateBackup(text)
    expect(Object.keys(data).sort()).toEqual(['foods', 'measurements'])
    expect(counts).toEqual([
      { table: 'foods', count: 2 },
      { table: 'measurements', count: 1 },
    ])
  })

  it('rejects invalid JSON', () => {
    expect(() => validateBackup('not json')).toThrow(/valid JSON/i)
  })

  it('rejects a file that is not a FitLog backup', () => {
    expect(() =>
      validateBackup(JSON.stringify({ app: 'Other', foods: [] })),
    ).toThrow(/FitLog backup/i)
  })

  it('rejects a table that is not a list', () => {
    expect(() =>
      validateBackup(JSON.stringify({ app: 'FitLog', foods: { id: 'f1' } })),
    ).toThrow(/should be a list/i)
  })

  it('rejects a backup with no recognizable tables', () => {
    expect(() => validateBackup(JSON.stringify({ app: 'FitLog' }))).toThrow(
      /no recognizable data/i,
    )
  })
})

describe('export -> import round-trip', () => {
  it('validateBackup accepts the shape exportData produces', () => {
    // exportData writes { app, exported_at, [table]: rows }, parents-first.
    const exported = {
      app: 'FitLog',
      exported_at: new Date().toISOString(),
      profiles: [{ id: 'p1', sex: 'male' }],
      foods: [{ id: 'f1' }],
      workouts: [{ id: 'w1' }],
      workout_sets: [{ id: 's1' }],
    }
    const { data, counts } = validateBackup(JSON.stringify(exported))
    expect(data.foods).toEqual([{ id: 'f1' }])
    expect(counts.map((c) => c.table)).toEqual([
      'profiles',
      'foods',
      'workouts',
      'workout_sets',
    ])
  })
})

describe('restoreBackup', () => {
  it('wipes children-first and re-inserts parents-first, sparing profiles', async () => {
    const parsed = validateBackup(
      JSON.stringify({
        app: 'FitLog',
        profiles: [{ id: 'old', user_id: 'old', sex: 'male' }],
        foods: [{ id: 'f1', user_id: 'old' }],
        workouts: [{ id: 'w1', user_id: 'old' }],
        workout_sets: [{ id: 's1', user_id: 'old' }],
      }),
    )
    await restoreBackup(parsed, 'me')

    const deletes = ops.filter((o) => o.op === 'delete').map((o) => o.table)
    const inserts = ops.filter((o) => o.op === 'insert').map((o) => o.table)

    expect(deletes).toEqual(['workout_sets', 'workouts', 'foods']) // children-first
    expect(deletes).not.toContain('profiles') // upserted in place, never wiped
    expect(inserts).toEqual(['foods', 'workouts', 'workout_sets']) // parents-first
  })

  it('forces the current user_id on inserted rows and the profile id', async () => {
    const parsed = validateBackup(
      JSON.stringify({
        app: 'FitLog',
        profiles: [{ id: 'old', user_id: 'old' }],
        foods: [{ id: 'f1', user_id: 'old' }],
      }),
    )
    await restoreBackup(parsed, 'me')

    const foodsInsert = ops.find((o) => o.op === 'insert' && o.table === 'foods')
    expect((foodsInsert?.rows as { user_id: string }[])[0].user_id).toBe('me')

    const profileUpsert = ops.find(
      (o) => o.op === 'upsert' && o.table === 'profiles',
    )
    expect((profileUpsert?.rows as { id: string }[])[0].id).toBe('me')
  })
})
