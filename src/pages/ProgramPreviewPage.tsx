import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Dumbbell,
  Moon,
  Plus,
  Save,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useProfile } from '@/features/profile/useProfile'
import { useRoutines } from '@/features/strength/useRoutines'
import { useApplyProgram } from '@/features/strength/useProgramPresets'
import {
  isPresetDay,
  presetDays,
  presetExerciseName,
  presetShapeLine,
  presetTotalSets,
  programById,
} from '@/data/programs'
import {
  activeProgramId,
  CUSTOM_PROGRAM_ID,
  customProgramLabel,
  cycleCounts,
  programIsRestorable,
} from '@/lib/program'
import { cn } from '@/lib/utils'

/**
 * Full preview of a preset before committing to it: every day, every exercise,
 * and a confirm sheet that spells out what the switch does and does not touch.
 * Re-picking a program you've used restores your saved copy of it rather than
 * seeding a second set of templates.
 */
export function ProgramPreviewPage() {
  const nav = useNavigate()
  const { presetId } = useParams()
  const { data: profile } = useProfile()
  const { data: routines } = useRoutines()
  const { apply, isPending } = useApplyProgram()
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preset = programById(presetId)
  const program = profile?.program ?? null
  const activeId = activeProgramId(program)

  const restorable = useMemo(() => {
    if (!preset) return false
    const existing = new Set((routines ?? []).map((r) => r.id))
    return programIsRestorable(program?.saved?.[preset.id], existing)
  }, [preset, program, routines])

  if (!preset)
    return (
      <div className="mx-auto min-h-svh w-full max-w-md bg-background">
        <PageHeader
          title="Program"
          left={
            <Button
              variant="ghost"
              size="icon"
              onClick={() => nav('/program/browse')}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          }
        />
        <p className="p-4 text-sm text-muted-foreground">
          That program isn’t available.
        </p>
      </div>
    )

  const isActive = activeId === preset.id
  const days = presetDays(preset)
  const outgoing =
    activeId === CUSTOM_PROGRAM_ID
      ? customProgramLabel(program)
      : (programById(activeId)?.name ?? 'your current program')
  const outgoingCount = cycleCounts(program?.sequence ?? []).lifts

  const confirm = async () => {
    setError(null)
    try {
      await apply(preset.id, preset)
      nav('/program')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch program')
      setConfirming(false)
    }
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title={preset.name}
        left={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => nav('/program/browse')}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <div>
          <p className="text-sm">{preset.blurb}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {presetShapeLine(preset)} · {presetTotalSets(preset)} sets per cycle
          </p>
        </div>

        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {preset.slots.map((slot, i) => {
              if (!isPresetDay(slot))
                return (
                  <div
                    key={`rest-${i}`}
                    className="flex items-center gap-2.5 p-3 text-muted-foreground"
                  >
                    <Moon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-sm">Rest day</span>
                  </div>
                )
              const open = openDay === slot.name
              const sets = slot.exercises.reduce((s, e) => s + e.sets, 0)
              return (
                <div key={slot.name}>
                  <button
                    onClick={() => setOpenDay(open ? null : slot.name)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2.5 p-3 text-left"
                  >
                    <Dumbbell className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-sm font-medium">
                      {slot.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {slot.exercises.length} · {sets} sets
                    </span>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                        open && 'rotate-180',
                      )}
                    />
                  </button>
                  {open && (
                    <div className="border-t border-border bg-muted/30 px-3 py-2">
                      {slot.exercises.map((e, k) => (
                        <div
                          key={`${e.key}-${k}`}
                          className="flex items-baseline gap-2 py-0.5 text-xs"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {presetExerciseName(e.key)}
                            {e.superset != null && (
                              <span className="ml-1.5 text-muted-foreground">
                                superset
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {e.sets} × {e.reps}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button
          className="w-full"
          disabled={isActive || isPending}
          onClick={() => setConfirming(true)}
        >
          {isActive
            ? 'Current program'
            : restorable
              ? 'Switch back to this program'
              : 'Use this program'}
        </Button>
      </div>

      {confirming &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={() => setConfirming(false)}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(e) => e.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="border-b border-border p-4">
                  <p className="font-medium">Switch to {preset.name}?</p>
                  <div className="mt-2 space-y-1.5 text-xs leading-snug text-muted-foreground">
                    {outgoingCount > 0 && (
                      <Line icon={<Save className="h-3.5 w-3.5" />} good>
                        {outgoing} is saved — switch back any time and its
                        rotation returns exactly as it is now.
                      </Line>
                    )}
                    <Line icon={<Check className="h-3.5 w-3.5" />} good>
                      All {routines?.length ?? 0} of your templates stay in your
                      routines list, untouched.
                    </Line>
                    <Line icon={<Check className="h-3.5 w-3.5" />} good>
                      Every logged workout, PR, and streak is unaffected.
                    </Line>
                    <Line icon={<Plus className="h-3.5 w-3.5" />}>
                      {restorable
                        ? `Restores your saved ${preset.name.toLowerCase()} rotation — no new templates.`
                        : `Adds ${days.length} new templates: ${days.map((d) => d.name).join(', ')}.`}
                    </Line>
                  </div>
                </div>
                <button
                  disabled={isPending}
                  onClick={confirm}
                  className="w-full p-4 text-center text-sm font-medium text-primary active:bg-accent disabled:opacity-60"
                >
                  {isPending ? 'Switching…' : 'Switch program'}
                </button>
              </Card>
              <button
                onClick={() => setConfirming(false)}
                className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

function Line({
  icon,
  good,
  children,
}: {
  icon: React.ReactNode
  good?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-2">
      <span
        className={cn(
          'mt-0.5 shrink-0',
          good ? 'text-emerald-600 dark:text-emerald-400' : '',
        )}
      >
        {icon}
      </span>
      <span>{children}</span>
    </div>
  )
}
