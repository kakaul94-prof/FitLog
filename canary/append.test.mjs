import { expect, test } from 'vitest'
import { appendRun, MAX } from './append.mjs'

const run = (run_id, timestamp = `2026-10-22T${String(run_id).padStart(2, '0')}:00:00Z`) => ({ run_id, timestamp, status: 'pass' })

test('starts a history, keeps it in time order and caps it at the newest runs', () => {
  expect(appendRun(null, run(1))).toEqual([run(1)])
  expect(appendRun([run(2)], run(1)).map((r) => r.run_id)).toEqual([1, 2])
  const full = Array.from({ length: MAX }, (_, i) => run(i, new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString()))
  const next = appendRun(full, run('new', '2026-12-01T00:00:00Z'))
  expect(next).toHaveLength(MAX)
  expect(next.at(-1).run_id).toBe('new')
  expect(next[0].run_id).toBe(1) // the oldest fell off
})

test('a re-run of the same workflow run replaces its record instead of counting twice', () => {
  const history = [run(1), run(2)]
  const next = appendRun(history, { ...run(1), status: 'fail' })
  expect(next.map((r) => [r.run_id, r.status])).toEqual([
    [1, 'fail'],
    [2, 'pass'],
  ])
})

test('local runs without an id never replace anything', () => {
  const next = appendRun([{ run_id: null, timestamp: '2026-10-22T01:00:00Z' }], { run_id: null, timestamp: '2026-10-22T02:00:00Z' })
  expect(next).toHaveLength(2)
})
