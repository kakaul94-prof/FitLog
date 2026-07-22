import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationOptions,
} from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todayISO, addDaysISO, computeStreak } from '@/lib/date'
import { syncStreakNudge } from '@/lib/reminders'
import type { DiaryEntry, Food, Meal, Nutrients } from '@/lib/database.types'

export function useDiary(date: string) {
  return useQuery({
    queryKey: ['diary', date],
    queryFn: async (): Promise<DiaryEntry[]> => {
      const { data, error } = await supabase
        .from('diary_entries')
        .select('*')
        .eq('entry_date', date)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as DiaryEntry[]
    },
  })
}

/** A chosen serving unit, overriding the food's base serving when logging. */
export type ServingOverride = {
  serving_qty?: number
  serving_unit?: string
  nutrients?: Nutrients
}

// --- Optimistic-update helpers (Phase 2 offline support) -------------------
// Writes go through TanStack's paused-mutation queue when offline (networkMode
// 'online'), so we update the diary cache optimistically in onMutate and roll
// back in onError. Inserts carry a client id + created_at so the optimistic row
// matches the row that eventually syncs (stashed on the variables object, which
// survives the offline pause + persistence, so mutationFn reuses the same id).

type DiarySnapshot = [QueryKey, DiaryEntry[] | undefined][]
type DiaryCtx = { snap: DiarySnapshot }

async function snapshotDiary(qc: QueryClient): Promise<DiarySnapshot> {
  await qc.cancelQueries({ queryKey: ['diary'] })
  return qc.getQueriesData<DiaryEntry[]>({ queryKey: ['diary'] })
}

function rollbackDiary(qc: QueryClient, snap: DiarySnapshot) {
  for (const [key, data] of snap) qc.setQueryData(key, data)
}

/** Patch matching rows (by id) across every cached diary-day list. */
function patchDiaryRows(qc: QueryClient, ids: string[], patch: Partial<DiaryEntry>) {
  const idset = new Set(ids)
  qc.setQueriesData<DiaryEntry[]>({ queryKey: ['diary'] }, (old) =>
    old ? old.map((r) => (idset.has(r.id) ? { ...r, ...patch } : r)) : old,
  )
}

/** Remove matching rows (by id) across every cached diary-day list. */
function removeDiaryRows(qc: QueryClient, ids: string[]) {
  const idset = new Set(ids)
  qc.setQueriesData<DiaryEntry[]>({ queryKey: ['diary'] }, (old) =>
    old ? old.filter((r) => !idset.has(r.id)) : old,
  )
}

/** A diary_entries insert row from a food + servings (snapshots the food), with
 *  a client id + created_at so the optimistic row == the synced row. Callers may
 *  supply the id up front (the picker's "added" tray edits rows it just made). */
function newDiaryRow(
  entry_date: string,
  meal: Meal,
  food: Food,
  servings: number,
  unit?: ServingOverride,
  id?: string,
) {
  return {
    id: id ?? crypto.randomUUID(),
    created_at: new Date().toISOString(),
    entry_date,
    meal,
    food_id: food.id,
    food_name: food.name,
    brand: food.brand,
    servings,
    serving_qty: unit?.serving_qty ?? food.serving_qty,
    serving_unit: unit?.serving_unit ?? food.serving_unit,
    nutrients: unit?.nutrients ?? food.nutrients,
  }
}

/** A Quick Add insert row (no source food). */
function newQuickRow(
  entry_date: string,
  meal: Meal,
  name: string | undefined,
  nutrients: Nutrients,
  id?: string,
) {
  return {
    id: id ?? crypto.randomUUID(),
    created_at: new Date().toISOString(),
    entry_date,
    meal,
    food_id: null,
    food_name: name?.trim() || 'Quick add',
    brand: null,
    servings: 1,
    serving_qty: null,
    serving_unit: null,
    nutrients,
  }
}

type InsertRow = ReturnType<typeof newDiaryRow> | ReturnType<typeof newQuickRow>

/** Promote an insert row to a full DiaryEntry for the optimistic cache (the
 *  unknown user_id/position aren't rendered; the refetch on settle fills them). */
function asCacheRow(row: InsertRow): DiaryEntry {
  return { user_id: '', position: 0, ...row } as DiaryEntry
}

type LogFoodVars = {
  entry_date: string
  meal: Meal
  food: Food
  servings: number
  unit?: ServingOverride
  /** Caller-chosen entry id (lets the picker edit the row right after adding). */
  id?: string
  _row?: ReturnType<typeof newDiaryRow>
}

type LogFoodsVars = {
  entry_date: string
  meal: Meal
  items: { food: Food; servings: number; unit?: ServingOverride; id?: string }[]
  _rows?: ReturnType<typeof newDiaryRow>[]
}

type QuickAddVars = {
  entry_date: string
  meal: Meal
  name?: string
  nutrients: Nutrients
  /** Caller-chosen entry id (lets the picker edit the row right after adding). */
  id?: string
  _row?: ReturnType<typeof newQuickRow>
}

type UpdateEntryVars = { id: string } & Partial<DiaryEntry>

// Stable keys so a write that was paused offline and PERSISTED (Phase 1
// dehydrates paused mutations) can be matched back to its function on restart:
// a restored mutation has only its key + variables, and resumePausedMutations
// looks the function up via the defaults registered below.
const KEYS = {
  logFood: ['diary', 'logFood'],
  logFoods: ['diary', 'logFoods'],
  quickAdd: ['diary', 'quickAdd'],
  quickAddFoods: ['diary', 'quickAddFoods'],
  updateServings: ['diary', 'updateServings'],
  deleteEntry: ['diary', 'deleteEntry'],
  deleteEntries: ['diary', 'deleteEntries'],
  move: ['diary', 'move'],
  updateEntry: ['diary', 'updateEntry'],
} as const

// Logging anything for today defers tonight's streak nudge to tomorrow
// (native app only; no-op on web). Runs in onMutate so it happens at log time
// even for the picker → kill-the-app flow where DiaryPage never remounts.
const nudgeIfToday = (entryDate: string) => {
  if (entryDate === todayISO()) void syncStreakNudge(true)
}

// Each mutation is defined ONCE as a factory shared by the live hook and the
// keyed default (so resume after an app-kill uses the exact same logic). The
// factory closes over the app's queryClient.

function logFoodMutation(
  qc: QueryClient,
): UseMutationOptions<void, Error, LogFoodVars, DiaryCtx> {
  return {
    mutationKey: KEYS.logFood,
    mutationFn: async (v) => {
      const row =
        v._row ?? newDiaryRow(v.entry_date, v.meal, v.food, v.servings, v.unit, v.id)
      const { error } = await supabase.from('diary_entries').insert(row)
      if (error) throw error
    },
    onMutate: async (v) => {
      const row = (v._row = newDiaryRow(
        v.entry_date,
        v.meal,
        v.food,
        v.servings,
        v.unit,
      ))
      const snap = await snapshotDiary(qc)
      qc.setQueryData<DiaryEntry[]>(['diary', v.entry_date], (old) => [
        ...(old ?? []),
        asCacheRow(row),
      ])
      nudgeIfToday(v.entry_date)
      return { snap }
    },
    onError: (_e, _v, ctx) => ctx && rollbackDiary(qc, ctx.snap),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ['diary', v.entry_date] })
      qc.invalidateQueries({ queryKey: ['streak'] })
      qc.invalidateQueries({ queryKey: ['foodHistory'] })
    },
  }
}

export function useLogFood() {
  return useMutation(logFoodMutation(useQueryClient()))
}

function logFoodsMutation(
  qc: QueryClient,
): UseMutationOptions<void, Error, LogFoodsVars, DiaryCtx> {
  return {
    mutationKey: KEYS.logFoods,
    mutationFn: async (v) => {
      const rows =
        v._rows ??
        v.items.map((it) =>
          newDiaryRow(v.entry_date, v.meal, it.food, it.servings, it.unit, it.id),
        )
      if (rows.length === 0) return
      const { error } = await supabase.from('diary_entries').insert(rows)
      if (error) throw error
    },
    onMutate: async (v) => {
      const rows = (v._rows = v.items.map((it) =>
        newDiaryRow(v.entry_date, v.meal, it.food, it.servings, it.unit, it.id),
      ))
      const snap = await snapshotDiary(qc)
      qc.setQueryData<DiaryEntry[]>(['diary', v.entry_date], (old) => [
        ...(old ?? []),
        ...rows.map(asCacheRow),
      ])
      nudgeIfToday(v.entry_date)
      return { snap }
    },
    onError: (_e, _v, ctx) => ctx && rollbackDiary(qc, ctx.snap),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ['diary', v.entry_date] })
      qc.invalidateQueries({ queryKey: ['streak'] })
      qc.invalidateQueries({ queryKey: ['foodHistory'] })
    },
  }
}

/** Log several foods to the same day/meal in one insert. */
export function useLogFoods() {
  return useMutation(logFoodsMutation(useQueryClient()))
}

function quickAddMutation(
  qc: QueryClient,
): UseMutationOptions<void, Error, QuickAddVars, DiaryCtx> {
  return {
    mutationKey: KEYS.quickAdd,
    mutationFn: async (v) => {
      const row = v._row ?? newQuickRow(v.entry_date, v.meal, v.name, v.nutrients, v.id)
      const { error } = await supabase.from('diary_entries').insert(row)
      if (error) throw error
    },
    onMutate: async (v) => {
      const row = (v._row = newQuickRow(v.entry_date, v.meal, v.name, v.nutrients, v.id))
      const snap = await snapshotDiary(qc)
      qc.setQueryData<DiaryEntry[]>(['diary', v.entry_date], (old) => [
        ...(old ?? []),
        asCacheRow(row),
      ])
      nudgeIfToday(v.entry_date)
      return { snap }
    },
    onError: (_e, _v, ctx) => ctx && rollbackDiary(qc, ctx.snap),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ['diary', v.entry_date] })
      qc.invalidateQueries({ queryKey: ['streak'] })
    },
  }
}

/**
 * Quick Add: log a bare calorie count (+ optional P/C/F) to a meal without
 * creating a food in the library — for restaurant / unknown meals. Snapshots
 * nutrients onto a food_id-less diary row (servings 1), like any other entry.
 */
export function useQuickAddFood() {
  return useMutation(quickAddMutation(useQueryClient()))
}

type QuickAddFoodsVars = {
  entry_date: string
  meal: Meal
  items: { name?: string; nutrients: Nutrients }[]
  _rows?: ReturnType<typeof newQuickRow>[]
}

function quickAddFoodsMutation(
  qc: QueryClient,
): UseMutationOptions<void, Error, QuickAddFoodsVars, DiaryCtx> {
  return {
    mutationKey: KEYS.quickAddFoods,
    mutationFn: async (v) => {
      const rows =
        v._rows ??
        v.items.map((it) =>
          newQuickRow(v.entry_date, v.meal, it.name, it.nutrients),
        )
      if (rows.length === 0) return
      const { error } = await supabase.from('diary_entries').insert(rows)
      if (error) throw error
    },
    onMutate: async (v) => {
      const rows = (v._rows = v.items.map((it) =>
        newQuickRow(v.entry_date, v.meal, it.name, it.nutrients),
      ))
      const snap = await snapshotDiary(qc)
      qc.setQueryData<DiaryEntry[]>(['diary', v.entry_date], (old) => [
        ...(old ?? []),
        ...rows.map(asCacheRow),
      ])
      nudgeIfToday(v.entry_date)
      return { snap }
    },
    onError: (_e, _v, ctx) => ctx && rollbackDiary(qc, ctx.snap),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ['diary', v.entry_date] })
      qc.invalidateQueries({ queryKey: ['streak'] })
    },
  }
}

/** Quick Add several items to one day/meal in a single insert (meal-photo scan). */
export function useQuickAddFoods() {
  return useMutation(quickAddFoodsMutation(useQueryClient()))
}

function updateServingsMutation(
  qc: QueryClient,
): UseMutationOptions<void, Error, { id: string; servings: number }, DiaryCtx> {
  return {
    mutationKey: KEYS.updateServings,
    mutationFn: async (e) => {
      const { error } = await supabase
        .from('diary_entries')
        .update({ servings: e.servings })
        .eq('id', e.id)
      if (error) throw error
    },
    onMutate: async (e) => {
      const snap = await snapshotDiary(qc)
      patchDiaryRows(qc, [e.id], { servings: e.servings })
      return { snap }
    },
    onError: (_e, _v, ctx) => ctx && rollbackDiary(qc, ctx.snap),
    onSettled: () => qc.invalidateQueries({ queryKey: ['diary'] }),
  }
}

export function useUpdateDiaryServings() {
  return useMutation(updateServingsMutation(useQueryClient()))
}

function deleteEntryMutation(
  qc: QueryClient,
): UseMutationOptions<void, Error, string, DiaryCtx> {
  return {
    mutationKey: KEYS.deleteEntry,
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('diary_entries')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onMutate: async (id) => {
      const snap = await snapshotDiary(qc)
      removeDiaryRows(qc, [id])
      return { snap }
    },
    onError: (_e, _v, ctx) => ctx && rollbackDiary(qc, ctx.snap),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['diary'] })
      qc.invalidateQueries({ queryKey: ['streak'] })
    },
  }
}

export function useDeleteDiaryEntry() {
  return useMutation(deleteEntryMutation(useQueryClient()))
}

function deleteEntriesMutation(
  qc: QueryClient,
): UseMutationOptions<void, Error, string[], DiaryCtx> {
  return {
    mutationKey: KEYS.deleteEntries,
    mutationFn: async (ids) => {
      if (ids.length === 0) return
      const { error } = await supabase
        .from('diary_entries')
        .delete()
        .in('id', ids)
      if (error) throw error
    },
    onMutate: async (ids) => {
      const snap = await snapshotDiary(qc)
      removeDiaryRows(qc, ids)
      return { snap }
    },
    onError: (_e, _v, ctx) => ctx && rollbackDiary(qc, ctx.snap),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['diary'] })
      qc.invalidateQueries({ queryKey: ['streak'] })
    },
  }
}

/** Delete several diary entries at once (multi-select). */
export function useDeleteDiaryEntries() {
  return useMutation(deleteEntriesMutation(useQueryClient()))
}

function moveMutation(
  qc: QueryClient,
): UseMutationOptions<void, Error, { ids: string[]; meal: Meal }, DiaryCtx> {
  return {
    mutationKey: KEYS.move,
    mutationFn: async (e) => {
      if (e.ids.length === 0) return
      const { error } = await supabase
        .from('diary_entries')
        .update({ meal: e.meal })
        .in('id', e.ids)
      if (error) throw error
    },
    onMutate: async (e) => {
      const snap = await snapshotDiary(qc)
      patchDiaryRows(qc, e.ids, { meal: e.meal })
      return { snap }
    },
    onError: (_e, _v, ctx) => ctx && rollbackDiary(qc, ctx.snap),
    onSettled: () => qc.invalidateQueries({ queryKey: ['diary'] }),
  }
}

/** Move diary entries to a different meal slot (single id or multi-select). */
export function useMoveDiaryEntries() {
  return useMutation(moveMutation(useQueryClient()))
}

function updateEntryMutation(
  qc: QueryClient,
): UseMutationOptions<void, Error, UpdateEntryVars, DiaryCtx> {
  return {
    mutationKey: KEYS.updateEntry,
    mutationFn: async ({ id, ...patch }) => {
      const { error } = await supabase
        .from('diary_entries')
        .update(patch)
        .eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, ...patch }) => {
      const snap = await snapshotDiary(qc)
      patchDiaryRows(qc, [id], patch)
      return { snap }
    },
    onError: (_e, _v, ctx) => ctx && rollbackDiary(qc, ctx.snap),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['diary'] })
      qc.invalidateQueries({ queryKey: ['diaryEntry'] })
      qc.invalidateQueries({ queryKey: ['streak'] })
    },
  }
}

export function useUpdateDiaryEntry() {
  return useMutation(updateEntryMutation(useQueryClient()))
}

/**
 * Register every optimistic diary mutation as a keyed default, so writes that
 * were paused offline and persisted can be RESUMED after an app restart (a
 * restored mutation has no function — resumePausedMutations finds it by key
 * here). Call once at startup with the app's queryClient, before render.
 */
export function registerDiaryMutationDefaults(qc: QueryClient) {
  qc.setMutationDefaults(KEYS.logFood, logFoodMutation(qc))
  qc.setMutationDefaults(KEYS.logFoods, logFoodsMutation(qc))
  qc.setMutationDefaults(KEYS.quickAdd, quickAddMutation(qc))
  qc.setMutationDefaults(KEYS.quickAddFoods, quickAddFoodsMutation(qc))
  qc.setMutationDefaults(KEYS.updateServings, updateServingsMutation(qc))
  qc.setMutationDefaults(KEYS.deleteEntry, deleteEntryMutation(qc))
  qc.setMutationDefaults(KEYS.deleteEntries, deleteEntriesMutation(qc))
  qc.setMutationDefaults(KEYS.move, moveMutation(qc))
  qc.setMutationDefaults(KEYS.updateEntry, updateEntryMutation(qc))
}

/** Copy all entries of one meal from another day into a target day/meal.
 *  Left non-optimistic (a remote read + insert); queues but may stall offline. */
export function useCopyMeal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: {
      from: string
      to: string
      meal: Meal
    }): Promise<number> => {
      const { data, error } = await supabase
        .from('diary_entries')
        .select('*')
        .eq('entry_date', e.from)
        .eq('meal', e.meal)
        .order('created_at')
      if (error) throw error
      const src = (data ?? []) as DiaryEntry[]
      if (src.length === 0) return 0
      const rows = src.map((r) => ({
        entry_date: e.to,
        meal: e.meal,
        food_id: r.food_id,
        food_name: r.food_name,
        brand: r.brand,
        servings: r.servings,
        serving_qty: r.serving_qty,
        serving_unit: r.serving_unit,
        nutrients: r.nutrients,
      }))
      const { error: insErr } = await supabase
        .from('diary_entries')
        .insert(rows)
      if (insErr) throw insErr
      return rows.length
    },
    onSuccess: (_n, v) => {
      qc.invalidateQueries({ queryKey: ['diary', v.to] })
      qc.invalidateQueries({ queryKey: ['streak'] })
      qc.invalidateQueries({ queryKey: ['foodHistory'] })
    },
  })
}

/** Copy given entries to another day, preserving each entry's meal slot.
 *  Left non-optimistic (targets another day); queues but may stall offline. */
export function useCopyEntriesToDay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: {
      to: string
      entries: DiaryEntry[]
    }): Promise<number> => {
      if (e.entries.length === 0) return 0
      const rows = e.entries.map((r) => ({
        entry_date: e.to,
        meal: r.meal,
        food_id: r.food_id,
        food_name: r.food_name,
        brand: r.brand,
        servings: r.servings,
        serving_qty: r.serving_qty,
        serving_unit: r.serving_unit,
        nutrients: r.nutrients,
      }))
      const { error } = await supabase.from('diary_entries').insert(rows)
      if (error) throw error
      return rows.length
    },
    onSuccess: (_n, v) => {
      qc.invalidateQueries({ queryKey: ['diary', v.to] })
      qc.invalidateQueries({ queryKey: ['streak'] })
      qc.invalidateQueries({ queryKey: ['foodHistory'] })
    },
  })
}

export function useDiaryEntry(id: string | undefined) {
  return useQuery({
    queryKey: ['diaryEntry', id],
    enabled: !!id,
    queryFn: async (): Promise<DiaryEntry | null> => {
      const { data, error } = await supabase
        .from('diary_entries')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data as DiaryEntry | null
    },
  })
}

/**
 * Food-logging streak: consecutive days (ending today, or yesterday if today
 * isn't logged yet) that have >=1 food entry. Computed fresh from the data each
 * time, so backfilling a missed day heals the gap and the streak resumes.
 */
export function useStreak() {
  return useQuery({
    queryKey: ['streak'],
    queryFn: async (): Promise<number> => {
      const since = addDaysISO(todayISO(), -800)
      const { data, error } = await supabase
        .from('diary_entries')
        .select('entry_date')
        .gte('entry_date', since)
      if (error) throw error
      const logged = new Set((data ?? []).map((r) => r.entry_date as string))
      return computeStreak(logged, todayISO())
    },
  })
}
