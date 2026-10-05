import { test, expect } from '../fixtures'

test('logs body weight and shows it in the progress history', async ({
  progressPage,
  aliceDb,
}) => {
  // A value unlikely to exist yet: 150–199 with one random decimal digit 1–9.
  const lb = 150 + Math.floor(Math.random() * 50) + (1 + Math.floor(Math.random() * 9)) / 10

  await progressPage.goto()
  await progressPage.logWeight(lb)

  await expect(progressPage.historyEntry(lb)).toBeVisible()
  await expect
    .poll(async () => {
      const { data } = await aliceDb
        .from('measurements')
        .select('value')
        .eq('type', 'weight')
        .eq('value', lb)
      return data?.length
    })
    .toBe(1)
})
