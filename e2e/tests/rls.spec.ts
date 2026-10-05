import { test, expect } from '@playwright/test'
import { anonClient, signedInClient } from '../support/api'
import { USERS } from '../support/env'

// Row-level security, tested at the API layer with the same anon key the app
// ships. supabase/seed.sql gives Bob a diary entry and a weight; Alice must
// never be able to see or change them, and signed-out requests see nothing.
test.describe('row-level security', () => {
  test('a user cannot read another user’s rows', async () => {
    const alice = await signedInClient(USERS.alice)

    for (const table of ['diary_entries', 'measurements']) {
      const { data, error } = await alice.from(table).select('id').eq('user_id', USERS.bob.id)
      expect(error).toBeNull()
      expect(data, `${table} leaked Bob's rows to Alice`).toEqual([])
    }
  })

  test('a user cannot write rows as someone else', async () => {
    const alice = await signedInClient(USERS.alice)

    const { error } = await alice.from('diary_entries').insert({
      user_id: USERS.bob.id,
      entry_date: '2026-01-01',
      food_name: 'Forged entry',
    })
    expect(error?.code).toBe('42501') // Postgres: RLS policy violation
  })

  test('a user cannot update or delete another user’s rows', async () => {
    const alice = await signedInClient(USERS.alice)
    const bob = await signedInClient(USERS.bob)

    // RLS filters Bob's rows out of Alice's UPDATE/DELETE, so they match nothing.
    const updated = await alice
      .from('diary_entries')
      .update({ food_name: 'Tampered' })
      .eq('user_id', USERS.bob.id)
      .select()
    expect(updated.data).toEqual([])

    const deleted = await alice.from('measurements').delete().eq('user_id', USERS.bob.id).select()
    expect(deleted.data).toEqual([])

    // Bob's data is untouched from his own point of view.
    const { data } = await bob.from('diary_entries').select('food_name')
    expect(data).toContainEqual({ food_name: "Bob's private sandwich" })
  })

  test('signed-out requests see no data', async () => {
    const { data } = await anonClient().from('diary_entries').select('id')
    expect(data).toEqual([])
  })
})
