import { afterEach, describe, expect, it, vi } from 'vitest'
import { restoreBackup, validateBackup } from './importData'

// Record the calls restoreBackup makes, without a real backend. The restore
// itself (wipe order, re-insert order, stamping rows as the caller's, all or
// nothing) runs in the database's restore_backup and is tested against a real
// one in api-tests/tests/resilience/test_restore_backup.py. (vi.hoisted so the
// mock factory below, which Vitest hoists above the import, can see `calls`.)
const { calls, reply } = vi.hoisted(() => ({
  calls: [] as { fn: string; args: unknown }[],
  reply: { error: null as { code: string; message: string } | null },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args })
      return Promise.resolve({ data: null, error: reply.error })
    },
    from: (table: string) => {
      throw new Error(`restore must not touch ${table} directly`)
    },
  },
}))

afterEach(() => {
  calls.length = 0
  reply.error = null
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
  const parsed = () =>
    validateBackup(
      JSON.stringify({
        app: 'FitLog',
        profiles: [{ id: 'old', sex: 'male' }],
        foods: [{ id: 'f1', user_id: 'old' }],
        workout_sets: [{ id: 's1', user_id: 'old' }],
      }),
    )

  it('sends the whole backup to the database in one call', async () => {
    const backup = parsed()
    await restoreBackup(backup)

    expect(calls).toEqual([{ fn: 'restore_backup', args: { backup: backup.data } }])
  })

  it('reports a refused restore as nothing changed', async () => {
    reply.error = { code: '23503', message: 'violates foreign key constraint' }

    await expect(restoreBackup(parsed())).rejects.toThrow(
      'Couldn’t restore: violates foreign key constraint. Nothing was changed.',
    )
  })

  it('says the database needs updating when the restore function is missing', async () => {
    reply.error = { code: 'PGRST202', message: 'Could not find the function public.restore_backup' }

    await expect(restoreBackup(parsed())).rejects.toThrow(/needs an update first.*Nothing was changed/)
  })
})
