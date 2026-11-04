// Pure logic behind drag-to-reorder on the live workout page: turn a new order
// of the *active* blocks into the workout_exercises position writes.

export interface ReorderBlock {
  /** Stable block id (exercise id, or `sg-<group>` for a superset). */
  key: string
  /** Finished blocks sit in "Completed", aren't draggable, keep their slots. */
  done: boolean
  exercises: { id: string; position: number }[]
}

/**
 * Position writes for dropping the active blocks into `activeOrder`. Blocks
 * are given in their current on-screen order; done blocks stay in their slots
 * and the active ones fill the remaining slots in the new order. Every exercise
 * is renumbered 0..n-1 (old positions can repeat after a delete + add), and
 * only the ones whose position changes are returned.
 *
 * null when `activeOrder` isn't exactly the current active blocks (the list
 * changed under the drag) — the caller should write nothing.
 */
export function reorderMoves(
  blocks: ReorderBlock[],
  activeOrder: string[],
): { id: string; position: number }[] | null {
  const active = blocks.filter((b) => !b.done)
  const byKey = new Map(active.map((b) => [b.key, b]))
  if (
    activeOrder.length !== active.length ||
    new Set(activeOrder).size !== activeOrder.length ||
    activeOrder.some((k) => !byKey.has(k))
  )
    return null
  let next = 0
  const full = blocks.flatMap((b) =>
    b.done ? b.exercises : byKey.get(activeOrder[next++])!.exercises,
  )
  return full.flatMap((e, i) => (e.position === i ? [] : [{ id: e.id, position: i }]))
}
