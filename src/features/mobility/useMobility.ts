import { useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useProfile, useUpdateProfile } from '@/features/profile/useProfile'
import { bankSeconds, emptyMobility } from '@/lib/mobility'
import { tickWarmup, untickWarmup } from '@/lib/warmup'
import { todayISO } from '@/lib/date'
import type {
  MobilityState,
  MobilityStretch,
  Profile,
  ProgramState,
} from '@/lib/database.types'

const uid = () => Math.random().toString(36).slice(2)

/** Read/write the Mobility list. It lives inside the existing `profiles.program`
 *  jsonb (alongside the lift rotation), so every write merges the whole program
 *  object back — never patch `program` from two places in one render. */
export function useMobility() {
  const { data: profile } = useProfile()
  const update = useUpdateProfile()
  const state: MobilityState = profile?.program?.mobility ?? emptyMobility()

  const save = (next: MobilityState) => {
    const program: ProgramState = {
      ...(profile?.program ?? { sequence: [] }),
      mobility: next,
    }
    return update.mutateAsync({ program })
  }

  return {
    state,
    isSaving: update.isPending,

    /** Bank a stretch's time against today. */
    bank: (stretchId: string, seconds: number) =>
      save(bankSeconds(state, stretchId, todayISO(), seconds, uid())),

    addStretch: (stretch: Omit<MobilityStretch, 'id'>) =>
      save({ ...state, stretches: [...state.stretches, { ...stretch, id: uid() }] }),

    updateStretch: (id: string, patch: Partial<Omit<MobilityStretch, 'id'>>) =>
      save({
        ...state,
        stretches: state.stretches.map((s) =>
          s.id === id ? { ...s, ...patch } : s,
        ),
      }),

    /** Remove a stretch and the time banked against it. */
    removeStretch: (id: string) =>
      save({
        stretches: state.stretches.filter((s) => s.id !== id),
        log: state.log.filter((e) => e.stretchId !== id),
      }),
  }
}

/** Tick/untick a workout's warm-up drills, banking into the Mobility list's
 *  Warm-up item. Ticks come in quick bursts and the profile update isn't
 *  optimistic, so writes are queued and each one rebuilds from the freshest
 *  cached profile — otherwise a second tap would merge over the first. */
export function useWarmupTicks(workoutId: string | undefined, date: string | undefined) {
  const qc = useQueryClient()
  const { data: profile } = useProfile()
  const update = useUpdateProfile()
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const state: MobilityState = profile?.program?.mobility ?? emptyMobility()

  const enqueue = (change: (s: MobilityState) => MobilityState) => {
    queue.current = queue.current
      .catch(() => {})
      .then(() => {
        const p = qc.getQueryData<Profile>(['profile'])
        const cur = p?.program?.mobility ?? emptyMobility()
        const program: ProgramState = { ...(p?.program ?? { sequence: [] }), mobility: change(cur) }
        return update.mutateAsync({ program })
      })
    return queue.current
  }

  return {
    state,
    tick: (drill: string, seconds: number) =>
      workoutId &&
      enqueue((s) =>
        tickWarmup(s, { workoutId, drill, date: date ?? todayISO(), seconds, id: uid(), stretchId: uid() }),
      ),
    untick: (drill: string) => workoutId && enqueue((s) => untickWarmup(s, workoutId, drill)),
  }
}
