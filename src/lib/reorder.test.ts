import { describe, expect, it } from 'vitest'
import { reorderMoves, type ReorderBlock } from './reorder'

const single = (id: string, position: number, done = false): ReorderBlock => ({
  key: id,
  done,
  exercises: [{ id, position }],
})

describe('reorderMoves', () => {
  it('moves an exercise above another and writes only what changed', () => {
    const blocks = [single('row', 0), single('chin', 1), single('incline', 2)]
    expect(reorderMoves(blocks, ['row', 'incline', 'chin'])).toEqual([
      { id: 'incline', position: 1 },
      { id: 'chin', position: 2 },
    ])
  })

  it('writes nothing when the order is unchanged', () => {
    const blocks = [single('a', 0), single('b', 1)]
    expect(reorderMoves(blocks, ['a', 'b'])).toEqual([])
  })

  it('moves a superset as one block, members kept together in order', () => {
    const ss: ReorderBlock = {
      key: 'sg-1',
      done: false,
      exercises: [
        { id: 'lat', position: 1 },
        { id: 'face', position: 2 },
      ],
    }
    const blocks = [single('a', 0), ss, single('b', 3)]
    expect(reorderMoves(blocks, ['sg-1', 'a', 'b'])).toEqual([
      { id: 'lat', position: 0 },
      { id: 'face', position: 1 },
      { id: 'a', position: 2 },
    ])
  })

  it('keeps finished blocks in their slots', () => {
    // done 'x' sits between the two active blocks; swapping them leaves it put.
    const blocks = [single('a', 0), single('x', 1, true), single('b', 2)]
    expect(reorderMoves(blocks, ['b', 'a'])).toEqual([
      { id: 'b', position: 0 },
      { id: 'a', position: 2 },
    ])
  })

  it('renumbers duplicate positions left by a delete + add', () => {
    const blocks = [single('a', 0), single('b', 2), single('c', 2)]
    expect(reorderMoves(blocks, ['c', 'a', 'b'])).toEqual([
      { id: 'c', position: 0 },
      { id: 'a', position: 1 },
    ])
  })

  it('refuses an order that no longer matches the active blocks', () => {
    const blocks = [single('a', 0), single('b', 1), single('x', 2, true)]
    expect(reorderMoves(blocks, ['a'])).toBeNull()
    expect(reorderMoves(blocks, ['a', 'zzz'])).toBeNull()
    expect(reorderMoves(blocks, ['a', 'a'])).toBeNull()
    expect(reorderMoves(blocks, ['a', 'x'])).toBeNull()
  })
})
