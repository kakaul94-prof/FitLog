import { useProfile, useUpdateProfile } from '@/features/profile/useProfile'
import type { TrainerFact } from '@/lib/database.types'

// Trainer memory: the durable facts the Ask-a-trainer chat carries between
// conversations. Stored as a jsonb array on the profile (no new table — this is
// a short, single-user list), so reads come free off the cached profile and
// writes reuse useUpdateProfile's cache handling.
//
// RUN supabase/migration_trainer_memory.sql (dev + prod) before this works; on
// a database without the column the read is [] and saving errors.

/** Keeps the injected prompt small and the list scannable. */
export const MAX_FACTS = 40
export const MAX_FACT_CHARS = 200

export function useTrainerMemory(): TrainerFact[] {
  const { data } = useProfile()
  const raw = data?.trainer_memory
  return Array.isArray(raw) ? raw : []
}

export function useAddTrainerFact() {
  const facts = useTrainerMemory()
  const update = useUpdateProfile()
  return {
    ...update,
    /** Appends a fact. Duplicates (case-insensitive) are dropped silently so
     *  tapping "Remember this" twice can't stack the same line. */
    add: (text: string) => {
      const clean = text.trim().slice(0, MAX_FACT_CHARS)
      if (!clean) return
      const exists = facts.some(
        (f) => f.text.trim().toLowerCase() === clean.toLowerCase(),
      )
      if (exists) return
      const fact: TrainerFact = {
        id: crypto.randomUUID(),
        text: clean,
        created_at: new Date().toISOString(),
      }
      // Oldest fall off the end once the list is full.
      update.mutate({ trainer_memory: [...facts, fact].slice(-MAX_FACTS) })
    },
  }
}

export function useRemoveTrainerFact() {
  const facts = useTrainerMemory()
  const update = useUpdateProfile()
  return {
    ...update,
    remove: (id: string) =>
      update.mutate({ trainer_memory: facts.filter((f) => f.id !== id) }),
  }
}
