import { useProfile, useUpdateProfile } from '@/features/profile/useProfile'
import {
  emptyRehab,
  logRehab,
  pruneLog,
  recordCheckin,
} from '@/lib/rehab'
import { todayISO } from '@/lib/date'
import type {
  Injury,
  RehabPlanItem,
  RehabState,
} from '@/lib/database.types'

const uid = () => Math.random().toString(36).slice(2)

/** Read/write the rehab centre. Lives in its own `profiles.rehab` jsonb (not
 *  `program`, which is the lift rotation), so writes here can't collide with
 *  the program editor or the mobility list. */
export function useRehab() {
  const { data: profile } = useProfile()
  const update = useUpdateProfile()
  const raw = profile?.rehab
  // A fresh profile reads back `{}` from the column default, so fill in the
  // arrays rather than trusting the shape.
  const state: RehabState = {
    injuries: raw?.injuries ?? [],
    log: raw?.log ?? [],
    checkins: raw?.checkins ?? [],
  }

  const save = (next: RehabState) => update.mutateAsync({ rehab: next })

  const patchInjury = (id: string, patch: Partial<Injury>) =>
    save({
      ...state,
      injuries: state.injuries.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    })

  return {
    state,
    isSaving: update.isPending,
    /** The column is missing until migration_rehab.sql has been run. */
    ready: profile == null || raw !== undefined,

    addInjury: (inj: Omit<Injury, 'id'>) => {
      const id = uid()
      return save({
        ...state,
        injuries: [...state.injuries, { ...inj, id }],
      }).then(() => id)
    },

    updateInjury: patchInjury,

    resolveInjury: (id: string) =>
      patchInjury(id, { status: 'resolved', resolved: todayISO() }),

    reopenInjury: (id: string) =>
      patchInjury(id, { status: 'active', resolved: null }),

    /** Removes the injury and everything logged against it. */
    removeInjury: (id: string) =>
      save({
        injuries: state.injuries.filter((i) => i.id !== id),
        log: state.log.filter((e) => e.injuryId !== id),
        checkins: state.checkins.filter((c) => c.injuryId !== id),
      }),

    addPlanItem: (injuryId: string, item: Omit<RehabPlanItem, 'id'>) =>
      patchInjury(injuryId, {
        plan: [
          ...(state.injuries.find((i) => i.id === injuryId)?.plan ?? []),
          { ...item, id: uid() },
        ],
      }),

    /** Attach several at once (a protocol), skipping ones already in the plan. */
    addPlanItems: (injuryId: string, items: Omit<RehabPlanItem, 'id'>[]) => {
      const plan = state.injuries.find((i) => i.id === injuryId)?.plan ?? []
      const have = new Set(plan.map((p) => p.key ?? p.name.toLowerCase()))
      const fresh = items
        .filter((it) => !have.has(it.key ?? it.name.toLowerCase()))
        .map((it) => ({ ...it, id: uid() }))
      if (fresh.length === 0) return Promise.resolve()
      return patchInjury(injuryId, { plan: [...plan, ...fresh] })
    },

    updatePlanItem: (
      injuryId: string,
      itemId: string,
      patch: Partial<Omit<RehabPlanItem, 'id'>>,
    ) =>
      patchInjury(injuryId, {
        plan: (state.injuries.find((i) => i.id === injuryId)?.plan ?? []).map(
          (p) => (p.id === itemId ? { ...p, ...patch } : p),
        ),
      }),

    removePlanItem: (injuryId: string, itemId: string) =>
      save({
        ...state,
        injuries: state.injuries.map((i) =>
          i.id === injuryId
            ? { ...i, plan: i.plan.filter((p) => p.id !== itemId) }
            : i,
        ),
        log: state.log.filter((e) => e.itemId !== itemId),
      }),

    /** Mark one session of a plan item done today. */
    logItem: (injuryId: string, itemId: string, seconds?: number | null) =>
      save(
        logRehab(state, injuryId, itemId, todayISO(), uid(), seconds),
      ),

    /** Undo the most recent session logged for an item today. */
    unlogItem: (injuryId: string, itemId: string) => {
      const today = todayISO()
      const hit = [...state.log]
        .reverse()
        .find(
          (e) =>
            e.injuryId === injuryId && e.itemId === itemId && e.date === today,
        )
      if (!hit) return Promise.resolve()
      return save({ ...state, log: state.log.filter((e) => e.id !== hit.id) })
    },

    /** Rate an injury today (replaces an earlier rating for the same day). */
    checkIn: (injuryId: string, pain: number) =>
      save(recordCheckin(state, injuryId, todayISO(), pain, uid())),

    /** Toggle an exercise on an injury's "aggravates" list. */
    toggleAggravates: (injuryId: string, key: string) => {
      const inj = state.injuries.find((i) => i.id === injuryId)
      if (!inj) return Promise.resolve()
      return patchInjury(injuryId, {
        aggravates: inj.aggravates.includes(key)
          ? inj.aggravates.filter((k) => k !== key)
          : [...inj.aggravates, key],
      })
    },

    /** Housekeeping on load-heavy writes; exposed for tests. */
    prune: () => save({ ...state, log: pruneLog(state.log, todayISO()) }),
  }
}

export { emptyRehab }
