import { useProfile, useUpdateProfile } from '@/features/profile/useProfile'
import { bankSeconds, emptyMobility } from '@/lib/mobility'
import { todayISO } from '@/lib/date'
import type {
  MobilityState,
  MobilityStretch,
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
