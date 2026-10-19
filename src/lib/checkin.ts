import { EXERCISES, type BuiltinExercise } from '@/data/exercises'
import { JOINT_STRESS, SWAPS } from '@/data/jointStress'
import { builtinKeyForName } from '@/data/exerciseAliases'
import { formatPain } from './rehab'
import type { CheckinFlag, PainLevel, WorkoutCheckin } from './database.types'

// Pre-workout check-in: what hurts today → which planned lifts load it → the
// first same-muscle alternative that doesn't. Pure, so it's unit-tested; the
// sheet (WorkoutCheckinSheet) and the trainer snapshot both read from here.

const BY_KEY = new Map(EXERCISES.map((e) => [e.key, e]))

/** Built-in key for a planned lift: its own key, or by name for custom and
 *  MFP-imported lifts ("Romanian Deadlifts" → romanian_deadlift). */
export function resolveLiftKey(key: string, name: string): string | undefined {
  if (BY_KEY.has(key)) return key
  return builtinKeyForName(name) ?? builtinKeyForName(name.replace(/s\b/gi, ''))
}

/** Joints a lift loads, or undefined when there's no rule for it. */
export function loadsFor(key: string, name: string): string[] | undefined {
  const k = resolveLiftKey(key, name)
  return k ? JOINT_STRESS[k] : undefined
}

export interface PlannedLift {
  /** routine_exercises.id — what the start mutation swaps or drops. */
  id: string
  key: string
  name: string
}

export type SwapAction = 'swap' | 'skip' | 'keep'

export interface Suggestion {
  lift: PlannedLift
  /** Flagged sites this lift loads. */
  hits: string[]
  level: PainLevel
  /** Alternatives that load none of today's flagged sites, best first. */
  options: BuiltinExercise[]
  /** Default: sharp → skip; sore → swap to options[0], or keep if none fits. */
  action: SwapAction
}

export interface CheckinPlan {
  suggestions: Suggestion[]
  /** Planned lifts with no rule — the trainer's job. */
  unknown: PlannedLift[]
}

/** Union of the joints today's lifts load, for the "Today works" row. */
export function sitesWorked(lifts: PlannedLift[]): string[] {
  const s = new Set<string>()
  for (const l of lifts) for (const site of loadsFor(l.key, l.name) ?? []) s.add(site)
  return [...s]
}

export function planSwaps(lifts: PlannedLift[], flags: CheckinFlag[]): CheckinPlan {
  const sharp = new Set(flags.filter((f) => f.level === 'sharp').map((f) => f.site))
  const sites = new Set(flags.map((f) => f.site).filter((s) => s !== 'other'))
  const out: CheckinPlan = { suggestions: [], unknown: [] }
  if (sites.size === 0) return out

  // Lifts already in the session aren't good swap targets — that would just
  // double one exercise — so they drop to the back, as does any alternative
  // an earlier swap already claimed.
  const taken = new Set(
    lifts.map((l) => resolveLiftKey(l.key, l.name)).filter(Boolean) as string[],
  )
  for (const lift of lifts) {
    const k = resolveLiftKey(lift.key, lift.name)
    const loads = k ? JOINT_STRESS[k] : undefined
    if (!k || !loads) {
      out.unknown.push(lift)
      continue
    }
    const hits = loads.filter((s) => sites.has(s))
    if (hits.length === 0) continue
    const safe = (SWAPS[k] ?? [])
      .filter((alt) => !(JOINT_STRESS[alt] ?? []).some((s) => sites.has(s)))
      .map((alt) => BY_KEY.get(alt))
      .filter((e): e is BuiltinExercise => !!e)
    const options = [
      ...safe.filter((e) => !taken.has(e.key)),
      ...safe.filter((e) => taken.has(e.key)),
    ]
    const level: PainLevel = hits.some((s) => sharp.has(s)) ? 'sharp' : 'sore'
    const action: SwapAction =
      level === 'sharp' ? 'skip' : options.length ? 'swap' : 'keep'
    if (action === 'swap') taken.add(options[0].key)
    out.suggestions.push({ lift, hits, level, options, action })
  }
  return out
}

/** "left knee achy, low back sharp" — banner + trainer line. A 'sore' joint
 *  is shown as achy, the word the check-in asks with. */
export function flagsLabel(flags: CheckinFlag[]): string {
  return flags
    .map((f) => `${formatPain(f.site, f.side)} ${f.level === 'sore' ? 'achy' : f.level}`)
    .join(', ')
}

/** One line for the trainer snapshot. */
export function checkinSummary(c: WorkoutCheckin): string {
  const parts = c.flags.length ? [flagsLabel(c.flags)] : []
  if (c.swaps.length)
    parts.push(`swapped ${c.swaps.map((s) => `${s.fromName} → ${s.toName}`).join('; ')}`)
  if (c.skipped.length) parts.push(`skipped ${c.skipped.join(', ')}`)
  return parts.join(' · ')
}
