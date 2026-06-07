import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { ChevronLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useExerciseHistory } from '@/features/strength/useStrength'
import { useCustomExercises } from '@/features/strength/useCustomExercises'
import { EXERCISES } from '@/data/exercises'

const METRICS = [
  { key: 'max', label: 'Max weight' },
  { key: 'total', label: 'Total volume' },
  { key: 'avg', label: 'Average weight' },
] as const
type MetricKey = (typeof METRICS)[number]['key']

const GREEN = '#16a34a'
const GRAY = '#9ca3af'

export function ExerciseProgressPage() {
  const { key } = useParams()
  const nav = useNavigate()
  const { data: history } = useExerciseHistory(key)
  const { data: custom } = useCustomExercises()
  const [metric, setMetric] = useState<MetricKey>('max')

  const rows = history ?? []
  const name =
    EXERCISES.find((e) => e.key === key)?.name ??
    (custom ?? []).find((c) => `custom:${c.id}` === key)?.name ??
    key ??
    'Exercise'
  const chartData = rows.map((r) => ({ date: r.date.slice(5), value: r[metric] }))
  const bestMax = rows.reduce((m, r) => Math.max(m, r.max), 0)
  const bestVol = rows.reduce((m, r) => Math.max(m, r.total), 0)
  const meta = METRICS.find((m) => m.key === metric) ?? METRICS[0]

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
      <PageHeader
        title={name}
        subtitle="Progress"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3 text-center">
            <div className="text-lg font-bold">{bestMax || '—'}</div>
            <div className="text-xs text-muted-foreground">Best set (lb)</div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-lg font-bold">{bestVol || '—'}</div>
            <div className="text-xs text-muted-foreground">Best volume (lb)</div>
          </Card>
        </div>

        <Select
          value={metric}
          onChange={(e) => setMetric(e.target.value as MetricKey)}
        >
          {METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </Select>

        <Card>
          <CardHeader>
            <CardTitle>{meta.label} over time</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length < 2 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Log this exercise in 2+ sessions to see a trend.
              </p>
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{ top: 5, right: 5, bottom: 0, left: -20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
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
                      stroke={GREEN}
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                      name={meta.label}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
