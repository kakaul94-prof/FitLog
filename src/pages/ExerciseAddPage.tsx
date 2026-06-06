import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ACTIVITIES } from '@/data/activities'
import { useLatestWeight } from '@/features/measurements/useMeasurements'
import { useLogExercise } from '@/features/exercise/useExercise'
import { metCalories, distanceCalories } from '@/lib/calc'
import { todayISO } from '@/lib/date'

export function ExerciseAddPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const date = params.get('date') || todayISO()
  const { data: weight } = useLatestWeight()
  const log = useLogExercise()

  const [key, setKey] = useState(ACTIVITIES[0].key)
  const [name, setName] = useState(ACTIVITIES[0].name)
  const [duration, setDuration] = useState('')
  const [distance, setDistance] = useState('')
  const [override, setOverride] = useState('')

  const act = ACTIVITIES.find((a) => a.key === key) ?? ACTIVITIES[0]
  const w = weight ?? null
  const dur = parseFloat(duration) || 0
  const dist = parseFloat(distance) || 0
  const est =
    w == null
      ? 0
      : act.distanceBased && dist
        ? distanceCalories(dist, w, act.met)
        : metCalories(act.met, dur, w)
  const calories = override ? parseInt(override) || 0 : est

  const onActivity = (k: string) => {
    setKey(k)
    const a = ACTIVITIES.find((x) => x.key === k)
    if (a) setName(a.name)
  }

  const onSave = async () => {
    await log.mutateAsync({
      entry_date: date,
      name: name.trim() || act.name,
      met: act.met,
      duration_min: dur || null,
      distance_mi: act.distanceBased && dist ? dist : null,
      calories,
    })
    nav('/exercise')
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
      <PageHeader
        title="Add exercise"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/exercise')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="space-y-1.5">
              <Label>Activity</Label>
              <Select value={key} onChange={(e) => onActivity(e.target.value)}>
                {ACTIVITIES.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exname">Name</Label>
              <Input
                id="exname"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dur">Duration (min)</Label>
              <Input
                id="dur"
                type="number"
                inputMode="numeric"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
            {act.distanceBased && (
              <div className="space-y-1.5">
                <Label htmlFor="dist">Distance (mi, optional)</Label>
                <Input
                  id="dist"
                  type="number"
                  inputMode="decimal"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Estimated burn
              </span>
              <span className="text-2xl font-bold">
                {calories}{' '}
                <span className="text-sm font-medium text-muted-foreground">
                  kcal
                </span>
              </span>
            </div>
            {w == null && (
              <p className="text-xs text-warning">
                Log your weight in Profile for an estimate.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ov">Override (optional — from your watch)</Label>
              <Input
                id="ov"
                type="number"
                inputMode="numeric"
                placeholder={String(est)}
                value={override}
                onChange={(e) => setOverride(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Button
          className="w-full"
          size="lg"
          onClick={onSave}
          disabled={log.isPending || calories <= 0}
        >
          {log.isPending ? 'Saving…' : 'Add exercise'}
        </Button>
      </div>
    </div>
  )
}
