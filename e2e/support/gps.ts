import { expect, type Page } from '@playwright/test'

/** One GPS reading; `atMs` is its timestamp relative to when it's sent. */
export interface Fix {
  lat: number
  lng: number
  accuracy?: number
  atMs: number
}

// 0.0002° of latitude is 22.239 m on the haversine sphere the app uses
// (R = 6,371 km), so expected distances can be worked out by hand.
export const STEP_DEG = 0.0002
export const STEP_M = 22.239

/** A straight walk north: one fix every `everyMs`, so `steps` hops after the first (anchor) fix. */
export function walkNorth(from: { lat: number; lng: number }, steps: number, everyMs = 10_000): Fix[] {
  return Array.from({ length: steps + 1 }, (_, i) => ({
    lat: from.lat + i * STEP_DEG,
    lng: from.lng,
    accuracy: 5,
    atMs: i * everyMs,
  }))
}

/** What the init script below exposes on window for the test to call. */
type FakeGpsWindow = Window & {
  __fakeGps: { watching(): number; send(fixes: Fix[]): void; fail(code: number): void }
}

/**
 * Replaces the browser's geolocation with one the test drives, plus Playwright's
 * fake clock. Together they make a "6-minute walk" deterministic and instant:
 * the test sends exact fixes with chosen timestamps, then fast-forwards the
 * app's timer. (On the web the app reads navigator.geolocation; the native
 * background-GPS path only exists in the Android build.)
 */
export class FakeGps {
  constructor(private readonly page: Page) {}

  async install(): Promise<void> {
    await this.page.clock.install()
    await this.page.addInitScript(() => {
      type Watcher = { ok: PositionCallback; err?: PositionErrorCallback | null }
      const watchers = new Map<number, Watcher>()
      let nextId = 1
      const geolocation = {
        watchPosition(ok: PositionCallback, err?: PositionErrorCallback | null) {
          watchers.set(nextId, { ok, err })
          return nextId++
        },
        clearWatch(id: number) {
          watchers.delete(id)
        },
        getCurrentPosition() {},
      }
      Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true })
      Object.assign(window, {
        __fakeGps: {
          watching: () => watchers.size,
          send(fixes: { lat: number; lng: number; accuracy?: number; atMs: number }[]) {
            const now = Date.now()
            for (const f of fixes) {
              const position = {
                coords: { latitude: f.lat, longitude: f.lng, accuracy: f.accuracy ?? 5 },
                timestamp: now + f.atMs,
              } as GeolocationPosition
              for (const w of watchers.values()) w.ok(position)
            }
          },
          fail(code: number) {
            const error = { code, message: 'fake', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }
            for (const w of watchers.values()) w.err?.(error as GeolocationPositionError)
          },
        },
      })
    })
  }

  /** The recorder subscribes asynchronously after Start; wait for it before sending fixes. */
  async waitUntilWatching(): Promise<void> {
    await expect.poll(() => this.page.evaluate(() => (window as unknown as FakeGpsWindow).__fakeGps.watching())).toBe(1)
  }

  async send(fixes: Fix[]): Promise<void> {
    await this.page.evaluate((f) => (window as unknown as FakeGpsWindow).__fakeGps.send(f), fixes)
  }

  /** Move the app's clock forward (elapsed time, timers). */
  async advance(ms: number): Promise<void> {
    await this.page.clock.fastForward(ms)
  }

  async denyPermission(): Promise<void> {
    await this.page.evaluate(() => (window as unknown as FakeGpsWindow).__fakeGps.fail(1))
  }
}
