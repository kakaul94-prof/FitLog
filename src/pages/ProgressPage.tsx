import { useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  useMeasurements,
  useLogMeasurement,
  useDeleteMeasurement,
} from '@/features/measurements/useMeasurements'
import { useProfile } from '@/features/profile/useProfile'
import { movingAverage, bmi } from '@/lib/calc'
import { todayISO } from '@/lib/date'

const TYPES = [
  { type: 'weight', label: 'Weight', unit: 'lb' },
  { type: 'body_fat', label: 'Body fat', unit: '%' },
  { type: 'waist', label: 'Waist', unit: 'in' },
]

const GREEN = '#16a34a'
const GRAY = '#9ca3af'

export function ProgressPage() {
  const [type, setType] = useState('weight')
  const meta = TYPES.find((t) => t.type === type) ?? TYPES[0]
  const { data: rows } = useMeasurements(type)
  const { data: profile } = useProfile()
  const logM = useLogMeasurement()
  const delM = useDeleteMeasurement()
  const [val, setVal] = useState('')

  const points = (rows ?? []).map((r) => ({ date: r.measured_on, value: r.value }))
  const trend = movingAverage(points, 7)
  const latest = points.length ? points[points.length - 1].value : null
  const first = points.length ? points[0].value : null
  const change = latest != null && first != null ? latest - first : null

  const chartData = trend.map((t) => ({
    date: t.date.slice(5),
    value: t.value,
    trend: Math.round(t.trend * 10) / 10,
  }))

  const bmiVal =
    type === 'weight' && latest != null && profile?.height_cm
      ? bmi(latest, profile.height_cm)
      : null

  const add = async () => {
    const v = parseFloat(val)
    if (Number.isNaN(v)) return
    await logM.mutateAsync({
      type,
      value: v,
      unit: meta.unit,
      measured_on: todayISO(),
    })
    setVal('')
  }

  return (
    <div>
      <PageHeader title="Progress" />
      <div className="space-y-4 p-4">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </Select>

        <Card>
          <CardContent className="flex items-end gap-2 p-4">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium">
                Log {meta.label.toLowerCase()} ({meta.unit})
              </label>
              <Input
                type="number"
                inputMode="decimal"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                placeholder={latest != null ? String(latest) : '—'}
              />
            </div>
            <Button onClick={add} disabled={logM.isPending || !val}>
              Add
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Latest" value={latest != null ? `${latest}` : '—'} />
          <Stat
            label="Change"
            value={
              change != null
                ? `${change > 0 ? '+' : ''}${Math.round(change * 10) / 10}`
                : '—'
            }
          />
          <Stat
            label={type === 'weight' ? 'BMI' : 'Goal'}
            value={
              type === 'weight'
                ? bmiVal != null
                  ? bmiVal.toFixed(1)
                  : '—'
                : profile?.goal_weight_lb
                  ? String(profile.goal_weight_lb)
                  : '—'
            }
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length < 2 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Log a few entries to see your trend.
              </p>
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{ top: 5, right: 5, bottom: 0, left: -20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke={GRAY} />
                    <YAxis
                      domain={['auto', 'auto']}
                      tick={{ fontSize: 11 }}
                      stroke={GRAY}
                    />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={GRAY}
                      strokeWidth={1}
                      dot={{ r: 2 }}
                      name="Logged"
                    />
                    <Line
                      type="monotone"
                      dataKey="trend"
                      stroke={GREEN}
                      strokeWidth={2.5}
                      dot={false}
                      name="7-day trend"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Faint line = daily logs · bold = 7-day average (the real trend)
            </p>
          </CardContent>
        </Card>

        {(rows ?? []).length > 0 && (
          <Card className="divide-y divide-border overflow-hidden">
            {[...(rows ?? [])]
              .reverse()
              .slice(0, 10)
              .map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 p-3 text-sm"
                >
                  <span className="text-muted-foreground">{r.measured_on}</span>
                  <span className="flex-1 text-right font-medium">
                    {r.value} {r.unit}
                  </span>
                  <button
                    onClick={() => delM.mutate(r.id)}
                    className="px-2 text-muted-foreground active:text-destructive"
                    aria-label="Delete"
                  >
                    ✕
                  </button>
                </div>
              ))}
          </Card>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3 text-center">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  )
}
