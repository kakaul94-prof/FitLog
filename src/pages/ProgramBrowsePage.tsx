import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  PersonStanding,
  Pencil,
  RotateCcw,
  Split,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useProfile, useUpdateProfile } from '@/features/profile/useProfile'
import { useRoutines } from '@/features/strength/useRoutines'
import { useApplyProgram } from '@/features/strength/useProgramPresets'
import { PROGRAMS, type PresetProgram } from '@/data/programs'
import {
  activeProgramId,
  CUSTOM_PROGRAM_ID,
  customProgramLabel,
  cycleCounts,
  programRoutineIds,
  pruneSequence,
} from '@/lib/program'
import { cn } from '@/lib/utils'

const ICONS = {
  LayoutGrid,
  Split,
  PersonStanding,
  TrendingUp,
} satisfies Record<PresetProgram['icon'], typeof LayoutGrid>

const shortDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })

/**
 * Program picker. Custom always sits first and is never presented as a lesser
 * option: it's what an existing rotation already is, and switching to a preset
 * parks it rather than replacing it (see switchProgramState).
 */
export function ProgramBrowsePage() {
  const nav = useNavigate()
  const { data: profile } = useProfile()
  const { data: routines } = useRoutines()
  const update = useUpdateProfile()
  const { apply, isPending } = useApplyProgram()
  const [renaming, setRenaming] = useState<string | null>(null)

  const program = profile?.program ?? null
  const activeId = activeProgramId(program)
  const isCustomActive = activeId === CUSTOM_PROGRAM_ID
  const customLabel = customProgramLabel(program)

  const routineName = useMemo(() => {
    const m = new Map((routines ?? []).map((r) => [r.id, r.name]))
    return (id: string) => m.get(id) ?? 'Workout'
  }, [routines])

  // What the custom rotation looks like right now: the live sequence when it's
  // active, otherwise the parked snapshot (pruned, so a template deleted while
  // away doesn't inflate the count).
  const customSeq = useMemo(() => {
    const existing = new Set((routines ?? []).map((r) => r.id))
    if (isCustomActive) return program?.sequence ?? []
    const saved = program?.saved?.[CUSTOM_PROGRAM_ID]?.sequence ?? []
    return pruneSequence(saved, existing)
  }, [program, routines, isCustomActive])

  const customCounts = cycleCounts(customSeq)
  const customNames = programRoutineIds(customSeq).map(routineName)
  const customLastUsed = program?.saved?.[CUSTOM_PROGRAM_ID]?.lastUsed
  const hasCustom = customCounts.lifts > 0

  const restoreCustom = async () => {
    await apply(CUSTOM_PROGRAM_ID, null)
    nav('/program')
  }

  const saveName = (name: string) => {
    update.mutate({
      program: {
        ...(program ?? { sequence: [] }),
        customName: name.trim() || null,
      },
    })
    setRenaming(null)
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title="Change program"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/program')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <Card
          className={cn(
            'p-4',
            isCustomActive && 'border-2 border-primary',
            !hasCustom && 'border-dashed',
          )}
        >
          <div className="flex items-start gap-3">
            <SlidersHorizontal
              className={cn(
                'mt-0.5 h-5 w-5 shrink-0',
                isCustomActive ? 'text-primary' : 'text-muted-foreground',
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{customLabel}</span>
                {isCustomActive ? (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                    Current
                  </span>
                ) : hasCustom ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    Saved
                  </span>
                ) : null}
              </div>
              {hasCustom ? (
                <>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[
                      `${customCounts.length} day${customCounts.length === 1 ? '' : 's'}`,
                      `${customCounts.lifts} template${customCounts.lifts === 1 ? '' : 's'}`,
                      ...(!isCustomActive && customLastUsed
                        ? [`last used ${shortDate(customLastUsed)}`]
                        : []),
                    ].join(' · ')}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {customNames.join(', ')}
                  </p>
                </>
              ) : (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Build your own rotation from your templates on the Program
                  page.
                </p>
              )}
              {isCustomActive && (
                <button
                  onClick={() => setRenaming(program?.customName ?? '')}
                  className="mt-2 flex items-center gap-1 text-xs font-medium text-primary"
                >
                  <Pencil className="h-3 w-3" /> Rename
                </button>
              )}
            </div>
            {!isCustomActive && hasCustom && (
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={restoreCustom}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore
              </Button>
            )}
          </div>
        </Card>

        <div>
          <p className="mb-2 px-1 text-xs text-muted-foreground">
            Ready-made splits
          </p>
          <div className="space-y-2">
            {PROGRAMS.map((p) => {
              const Icon = ICONS[p.icon]
              const isActive = activeId === p.id
              const saved = program?.saved?.[p.id]
              return (
                <button
                  key={p.id}
                  onClick={() => nav(`/program/browse/${p.id}`)}
                  className="block w-full text-left"
                >
                  <Card
                    className={cn(
                      'flex items-center gap-3 p-4',
                      isActive && 'border-2 border-primary',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-5 w-5 shrink-0',
                        isActive ? 'text-primary' : 'text-muted-foreground',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        {isActive && (
                          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                            Current
                          </span>
                        )}
                        {!isActive && saved && (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            Saved
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {p.shape}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {p.blurb}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Card>
                </button>
              )
            })}
          </div>
        </div>

        <p className="px-1 text-xs leading-snug text-muted-foreground">
          Switching parks your current rotation instead of replacing it — every
          program keeps its own saved days, and your templates and logged
          workouts are never touched.
        </p>
      </div>

      {renaming !== null &&
        createPortal(
          <RenameSheet
            initial={renaming}
            onCancel={() => setRenaming(null)}
            onSave={saveName}
          />,
          document.body,
        )}
    </div>
  )
}

function RenameSheet({
  initial,
  onCancel,
  onSave,
}: {
  initial: string
  onCancel: () => void
  onSave: (name: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
      onClick={onCancel}
    >
      <div
        className="mx-auto w-full max-w-md p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="p-4">
          <p className="mb-2 text-sm font-medium">Name your program</p>
          <Input
            autoFocus
            value={value}
            maxLength={40}
            placeholder="Custom program"
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="mt-3 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={() => onSave(value)}>
              Save
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
