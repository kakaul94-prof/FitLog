import { expect, test } from '../fixtures'
import { exerciseEntries } from '../support/data'
import { authFile } from '../support/env'
import { STEP_DEG, walkNorth } from '../support/gps'

// The GPS recorder, driven by a fake GPS and Playwright's fake clock
// (support/gps.ts): routes, noise and minutes pass exactly as scripted.
// One hop north is 22.239 m, so expected miles are worked out by hand.
test.use({ storageState: authFile('erin') })

const HOME = { lat: 40, lng: -75 }

test.beforeEach(async ({ gps, trackPage: track, page }) => {
  await page.goto('/') // so saving the review returns to the diary
  await track.goto()
  await track.startButton.click()
  await gps.waitUntilWatching()
})

test('records a walk and hands distance, time and calories to the review', async ({
  gps,
  trackPage: track,
  cardioPage,
  erinDb,
}) => {
  await gps.send(walkNorth(HOME, 36)) // 36 × 22.239 m = 800.6 m = 0.497 mi, over 6 min
  await gps.advance(360_000)
  await expect(track.distance('0.50')).toBeVisible()

  const handoff = await track.stop()
  expect(handoff.get('dist')).toBe('0.50')
  expect(handoff.get('dur')).toBe('6')
  const kcal = Number(handoff.get('kcal'))
  expect(kcal).toBeGreaterThan(0)
  await expect(cardioPage.calories(kcal)).toBeVisible()
  await cardioPage.save()

  const saved = await exerciseEntries(erinDb, handoff.get('date')!)
  expect(saved.at(-1)).toMatchObject({ name: 'Walking', distance_mi: 0.5, duration_min: 6, calories: kcal })
})

test('inaccurate fixes, teleports and jitter add no distance', async ({ gps, trackPage: track }) => {
  const route = walkNorth(HOME, 10) // the real walk: 10 × 22.239 m = 0.138 mi
  const noise = [
    { lat: HOME.lat + 0.01, lng: HOME.lng, accuracy: 50, atMs: route[3].atMs + 3_000 }, // 50 m accuracy
    { lat: HOME.lat + 0.05, lng: HOME.lng, accuracy: 5, atMs: route[5].atMs + 2_000 }, // 5.5 km in 2 s
    { lat: route[7].lat + 0.00001, lng: HOME.lng, accuracy: 5, atMs: route[7].atMs + 3_000 }, // 1 m wobble
  ]
  await gps.send([...route, ...noise].sort((a, b) => a.atMs - b.atMs))

  await expect(track.distance('0.14')).toBeVisible() // unfiltered, this would be several miles
})

test('time and movement while paused are left out', async ({ gps, trackPage: track }) => {
  await gps.send(walkNorth(HOME, 10))
  await gps.advance(100_000)

  await track.pauseButton.click()
  await gps.send(walkNorth({ lat: HOME.lat + 10 * STEP_DEG, lng: HOME.lng }, 20)) // walked on while paused
  await gps.advance(300_000)
  await track.resumeButton.click()

  // Resumes ~850 m east of where it paused: that gap must not count either.
  await gps.send(walkNorth({ lat: HOME.lat, lng: HOME.lng + 0.01 }, 10))
  await gps.advance(100_000)
  await expect(track.distance('0.28')).toBeVisible() // 20 hops × 22.239 m

  const handoff = await track.stop()
  expect(handoff.get('dist')).toBe('0.28')
  expect(handoff.get('dur')).toBe('3') // 200 s moving; the 300 s pause is excluded
})

test('a denied location permission shows an error and records nothing', async ({ gps, trackPage: track }) => {
  await gps.denyPermission()

  await expect(track.message('Location permission was denied.')).toBeVisible()
  await expect(track.distance('0.00')).toBeVisible()
})
