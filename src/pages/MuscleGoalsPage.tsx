import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Minus, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useProfile, useUpdateProfile } from '@/features/profile/useProfile'
import {
  DEFAULT_GOALS,
  REGION_IDS,
  REGION_LABEL,
  resolveGoals,
  type RegionId,
} from '@/data/bodyMap'

// Editor layout — the 18 regions grouped so it reads as a workout, not a flat list.
const GROUPS: { title: string; regions: RegionId[] }[] = [
  { title: 'Push', regions: ['chest', 'shoulders', 'side_delts', 'triceps'] },
  {
    title: 'Pull',
    regions: ['lats', 'upper_back', 'trapezius', 'rear_delts', 'biceps', 'forearm'],
  },
  { title: 'Legs', regions: ['quads', 'hams', 'glutes', 'calves'] },
  {
    title: 'Core & lower back',
    regions: ['rectus_abdominis', 'lower_abs', 'obliques', 'erector_spinae'],
  },
]

const clamp = (n: number) => Math.max(0, Math.min(40, Math.round(n) || 0))

export function MuscleGoalsPage() {
  const nav = useNavigate()
  const { data: profile } = useProfile()
  const update = useUpdateProfile()

  const saved = useMemo(() => resolveGoals(profile?.volume_targets), [profile])
  const [draft, setDraft] = useState<Record<RegionId, number> | null>(null)
  const goals = draft ?? saved
  const dirty = draft != null && REGION_IDS.some((r) => draft[r] !== saved[r])

  const setGoal = (r: RegionId, v: number) =>
    setDraft({ ...goals, [r]: clamp(v) })

  const onSave = () =>
    update.mutate(
      { volume_targets: goals },
      { onSuccess: () => nav('/lift/volume') },
    )

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
      <PageHeader
        title="Weekly set goals"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/lift/volume')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={
          <Button size="sm" onClick={onSave} disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <p className="text-xs text-muted-foreground">
          Target sets per muscle each week. The muscle map shades each muscle
          relative to its own goal. Set a goal to <strong>0</strong> to leave a
          muscle untracked (it stays neutral on the map).
        </p>

        {profile === undefined ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Loading…
          </Card>
        ) : (
          GROUPS.map((g) => (
            <Card key={g.title} className="p-3">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {g.title}
              </div>
              <div className="divide-y divide-border">
                {g.regions.map((r) => (
                  <GoalRow
                    key={r}
                    label={REGION_LABEL[r]}
                    value={goals[r]}
                    onChange={(v) => setGoal(r, v)}
                  />
                ))}
              </div>
            </Card>
          ))
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setDraft({ ...DEFAULT_GOALS })}
          >
            Reset to defaults
          </button>
          {update.isError && (
            <span className="text-xs text-destructive">Couldn’t save</span>
          )}
        </div>
      </div>
    </div>
  )
}

function GoalRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(value - 1)}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          aria-label={`${label} weekly set goal`}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
          className="h-8 w-12 rounded-md border border-input bg-background text-center text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(value + 1)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
