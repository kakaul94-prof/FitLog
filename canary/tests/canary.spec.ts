import { expect, test } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DiaryPage } from '../../e2e/pages/DiaryPage'
import { FoodPickerPage } from '../../e2e/pages/FoodPickerPage'
import { LoginPage } from '../../e2e/pages/LoginPage'
import { TrainerPage } from '../../e2e/pages/TrainerPage'
import { target } from '../env'
import { STEPS } from '../steps.mjs'
import { CANARY_PREFIX, canaryEntries, monitorDb, sweep } from '../support/db'

// The journey a real user makes, against production, as the monitor account:
// sign in, see today's diary, log a food, see it saved, delete it, ask the
// trainer. Each step is a test.step so the report, the alert and the dashboard
// say which one failed. Everything written is removed in the same run, and a
// crashed run's leftovers (1 kcal entries named "Canary check …") are swept at
// the start of the next.
const t = target()
const KCAL = 1
const QUESTION = 'In one sentence: what is a good first warm-up set before squats?'

const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('the production journey', async ({ page }, info) => {
  const entryName = `${CANARY_PREFIX} ${process.env.GITHUB_RUN_ID ?? 'local'}`
  const login = new LoginPage(page)
  const diary = new DiaryPage(page)
  const picker = new FoodPickerPage(page)
  const chat = new TrainerPage(page)
  let db: SupabaseClient | undefined

  // What this run was, for summarize.mjs (the report is the record of truth).
  info.annotations.push(
    { type: 'site', description: t.siteUrl },
    { type: 'trainer', description: String(t.trainer) },
    { type: 'drill', description: t.drill },
  )

  try {
    await test.step(STEPS[0], async () => {
      await login.goto()
      await login.signIn(t.email, t.password)
      await diary.expectLoaded()
      await expect(diary.navTab('Diary')).toBeVisible()
    })

    await test.step(STEPS[1], async () => {
      const loaded = page.waitForResponse(
        (r) => r.url().includes('/rest/v1/diary_entries') && r.request().method() === 'GET' && r.ok(),
      )
      await diary.gotoDate(today())
      await loaded
      // The day's calorie card: the ring when a goal is set, or "N calories
      // eaten. Set your goal…" when it isn't. The monitor account stays empty
      // on purpose, so in production it has no goal and shows the second.
      const calorieCard = page.getByLabel(/calories (remaining|over budget)$/).or(page.getByText(/calories eaten\./))
      await expect(calorieCard.first()).toBeVisible()
      await expect(page.getByRole('button', { name: /^Snacks( \+ Add| \d+ cal)/ })).toBeVisible()
      // The drill: a heading the app has never had. Fails here, before anything is written.
      if (t.drill === 'selector') {
        await expect(page.getByRole('heading', { name: 'Diary (canary drill)' })).toBeVisible({ timeout: 3_000 })
      }
    })

    await test.step(STEPS[2], async () => {
      db = await monitorDb(t)
      await sweep(db)
      await diary.openAddFood('Snacks')
      await picker.quickAdd('snacks', entryName, KCAL)
      await picker.doneButton.click()
      await diary.expectLoaded()
      await expect(diary.entryRow(entryName, KCAL)).toBeVisible()
      // Not just drawn: in Postgres, owned by the monitor, in the right meal, today.
      await expect
        .poll(
          async () =>
            (await canaryEntries(db!)).map((r) => ({ food_name: r.food_name, meal: r.meal, date: r.entry_date, kcal: r.nutrients?.kcal })),
          { message: 'the entry reached the database' },
        )
        .toEqual([{ food_name: entryName, meal: 'snacks', date: today(), kcal: KCAL }])
    })

    await test.step(STEPS[3], async () => {
      const row = diary.entryRow(entryName, KCAL)
      await diary.openMenu(row)
      await diary.menuAction('Delete entry').click()
      await expect(row).toBeHidden()
      await expect.poll(() => canaryEntries(db!), { message: 'the entry is gone from the database' }).toEqual([])
    })

    if (t.trainer) {
      await test.step(STEPS[4], async () => {
        await chat.goto()
        const answered = page.waitForResponse((r) => r.url().includes('/api/trainer'), { timeout: 60_000 })
        await chat.ask(QUESTION)
        const res = await answered
        expect(res.status(), 'the trainer endpoint answered').toBe(200)
        // Streaming: Stop shows while the answer arrives and Send comes back when it is whole.
        await expect(chat.stopButton).toBeHidden({ timeout: 60_000 })
        await expect(chat.thinking).toBeHidden()
        const reply = page.locator('div.rounded-2xl').last()
        await expect(reply, 'the last bubble is an answer, not an error').not.toHaveClass(/destructive/)
        const text = ((await reply.textContent()) ?? '').trim()
        expect(text.length, 'the trainer said something').toBeGreaterThan(20)
        expect(text).not.toMatch(/was cut off|went wrong|sign in/i)
      })
    }
  } finally {
    if (db) {
      await sweep(db).catch(() => {})
      await db.auth.signOut().catch(() => {}) // global: ends the browser's session too
    }
  }
})
