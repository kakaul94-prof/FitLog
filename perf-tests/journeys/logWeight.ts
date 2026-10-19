// Log a weigh-in: the weight page reads the latest value and the full history
// for its chart, the user types the number, it is saved (useLogMeasurement →
// insertOnce) and the latest value refetches.
import { expectRow, expectRows } from '../lib/checks.ts'
import { uuid } from '../lib/ids.ts'
import { batch, rest } from '../lib/rest.ts'
import { think } from '../lib/think.ts'
import type { Ctx } from '../lib/users.ts'

export function logWeight(ctx: Ctx): void {
  const r = rest(ctx.caller)
  const latest = () => r.from('measurements').select('value').eq('type', 'weight').order('measured_on', { ascending: false }).limit(1)

  const [last, history] = batch([
    latest().prepare('GET', 'weight.latest'),
    r.from('measurements').select('*').eq('type', 'weight').order('measured_on').prepare('GET', 'measurements.list'),
  ])
  const rows = expectRows<{ value: number }>(last, 'weight.latest', 1)
  expectRows(history, 'measurements.list', 1)
  think(2, 4) // stepping on the scale, typing the number

  const previous = rows[0]?.value ?? 180
  const value = Math.round((previous + (Math.random() - 0.5) * 2) * 10) / 10
  expectRow(r.from('measurements').select('*').single().insert({ id: uuid(), type: 'weight', measured_on: ctx.today, value, unit: 'lb' }, 'measurements.insert', 'representation'), 'measurements.insert', 201)
  think(0.3, 0.8)
  expectRows(latest().get('weight.latest'), 'weight.latest', 1)
  think(1, 3)
}
