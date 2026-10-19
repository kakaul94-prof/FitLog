import { expect, type Page, type Request, type Route } from '@playwright/test'

// Network faults for the resilience specs, all driven by Playwright's request
// interception rather than timing: a test decides exactly when a request is
// answered, lost or refused, so every run takes the same path.

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

/** Which requests to act on, beyond table and method: a query or body check. */
export type RequestMatch = (request: Request) => boolean

/** Intercept the app's Supabase REST calls on one table with one method. */
async function onRest(
  page: Page,
  table: string,
  method: Method,
  handler: (route: Route) => Promise<void>,
  match: RequestMatch = () => true,
): Promise<void> {
  await page.route(
    (url) => url.pathname === `/rest/v1/${table}`,
    (route) =>
      route.request().method() === method && match(route.request()) ? handler(route) : route.fallback(),
  )
}

/** Match a request whose query string contains `text`, e.g. `entry_date=eq.2024-02-01`. */
export const withQuery =
  (text: string): RequestMatch =>
  (request) =>
    decodeURIComponent(new URL(request.url()).search).includes(text)

/** Match a request whose JSON body has these values, e.g. `{ servings: 2 }`. */
export const withBody =
  (values: Record<string, unknown>): RequestMatch =>
  (request) => {
    const body = request.postDataJSON() as Record<string, unknown> | null
    return !!body && Object.entries(values).every(([k, v]) => body[k] === v)
  }

export interface LostReply {
  /** Resolves with the status the server sent (the app never sees it). */
  committed: Promise<number>
}

/**
 * The next such request reaches the database and is committed, but the
 * connection drops before the app hears back: the classic "did it save?"
 * case a retry has to survive.
 */
export async function loseReplyOnce(page: Page, table: string, method: Method): Promise<LostReply> {
  let committed!: (status: number) => void
  const status = new Promise<number>((resolve) => (committed = resolve))
  let used = false
  await onRest(page, table, method, async (route) => {
    if (used) return route.fallback()
    used = true
    const response = await route.fetch()
    committed(response.status())
    await route.abort('connectionreset')
  })
  // Wrapped, not returned bare: an async function would wait for it.
  return { committed: status }
}

/**
 * The page's next write of any kind (an insert, update, delete or function
 * call on any table) reaches the database and commits, but its reply is lost.
 * For multi-step operations, where it's the first step that gets cut off.
 */
export async function loseNextWriteReply(page: Page): Promise<LostReply> {
  let committed!: (status: number) => void
  const status = new Promise<number>((resolve) => (committed = resolve))
  let used = false
  await page.route(
    (url) => url.pathname.startsWith('/rest/v1/'),
    async (route) => {
      if (used || route.request().method() === 'GET') return route.fallback()
      used = true
      const response = await route.fetch()
      committed(response.status())
      await route.abort('connectionreset')
    },
  )
  return { committed: status }
}

/** The next such request never reaches the database: the server answers `status`. */
export async function refuseOnce(page: Page, table: string, method: Method, status = 503): Promise<void> {
  let used = false
  await onRest(page, table, method, async (route) => {
    if (used) return route.fallback()
    used = true
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST000', message: 'Service unavailable', details: null, hint: null }),
    })
  })
}

/** Every such request is refused: for multi-step writes that must fail at one step. */
export async function refuseAll(page: Page, table: string, method: Method, status = 500): Promise<void> {
  await onRest(page, table, method, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'XX000', message: 'Injected failure', details: null, hint: null }),
    }),
  )
}

export interface HeldRequest {
  /** Resolves once the request has been sent by the app and is being held. */
  arrived: Promise<void>
  /** Let it through to the server. */
  release: () => void
}

/** Hold the next such request at the network until the test releases it. */
export async function holdNext(
  page: Page,
  table: string,
  method: Method,
  match?: RequestMatch,
): Promise<HeldRequest> {
  let arrive!: () => void
  const arrived = new Promise<void>((resolve) => (arrive = resolve))
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  let used = false
  await onRest(page, table, method, async (route) => {
    if (used) return route.fallback()
    used = true
    arrive()
    await released
    await route.continue()
  }, match)
  return { arrived, release }
}

/**
 * Hold every such request from now on (not just the first) until released,
 * so a retry or a second refetch can't slip past while the test looks.
 */
export async function holdAll(page: Page, table: string, method: Method, match?: RequestMatch): Promise<HeldRequest> {
  let arrive!: () => void
  const arrived = new Promise<void>((resolve) => (arrive = resolve))
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  await onRest(page, table, method, async (route) => {
    arrive()
    await released
    await route.continue()
  }, match)
  return { arrived, release }
}

// -- the app's write queue (TanStack Query mutations) -------------------------

export interface QueuedWrite {
  /** The mutation key, e.g. "diary/deleteEntry"; "" for an unkeyed write. */
  key: string
  status: 'idle' | 'pending' | 'success' | 'error'
  /** Waiting: offline, or queued behind an earlier write in the same scope. */
  paused: boolean
}

/** What the app's write queue holds right now (dev-only window.__queryClient). */
export function writeQueue(page: Page): Promise<QueuedWrite[]> {
  return page.evaluate(() => {
    type Mutation = {
      options: { mutationKey?: readonly unknown[] }
      state: { status: QueuedWrite['status']; isPaused: boolean }
    }
    const qc = (globalThis as unknown as {
      __queryClient?: { getMutationCache: () => { getAll: () => Mutation[] } }
    }).__queryClient
    if (!qc) return [] // the app hasn't started yet (e.g. mid-reload)
    return qc
      .getMutationCache()
      .getAll()
      .map((m) => ({
        key: (m.options.mutationKey ?? []).join('/'),
        status: m.state.status,
        paused: m.state.isPaused,
      }))
  })
}

/**
 * Wait until the app has nothing in flight: no write pending (queued or being
 * sent) and no read being fetched. Settled writes refetch what they touched,
 * so this is the point where the screen shows what the server has.
 */
export async function waitForIdle(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page
          .evaluate(() => {
            const qc = (globalThis as unknown as {
              __queryClient?: { isMutating: () => number; isFetching: () => number }
            }).__queryClient
            return qc ? qc.isMutating() + qc.isFetching() : -1 // -1: the app is still starting
          })
          .catch(() => -1), // the page was mid-navigation: look again
      { message: 'writes and reads in flight' },
    )
    .toBe(0)
}

// -- connectivity ----------------------------------------------------------------

/** The floating status pill: "Offline", "Offline · N pending" or "Syncing N…". */
export const statusPill = (page: Page) => page.getByText(/^(Offline|Offline · \d+ pending|Syncing \d+…)$/)

export async function goOffline(page: Page): Promise<void> {
  await page.context().setOffline(true)
  await expect(statusPill(page)).toBeVisible()
}

export async function goOnline(page: Page): Promise<void> {
  await page.context().setOffline(false)
}

/**
 * Count full page loads from now on. An in-session sync must not lean on a
 * reload (which would restore the queue from disk instead), so tests check
 * this stays at 0.
 */
export function countReloads(page: Page): () => number {
  let loads = 0
  page.on('load', () => loads++)
  return () => loads
}

/** Back online and every queued write has settled (the pill disappears). */
export async function waitForSync(page: Page): Promise<void> {
  await expect(statusPill(page)).toBeHidden()
}

// -- the persisted cache (IndexedDB via idb-keyval) -----------------------------

const IDB = { db: 'keyval-store', store: 'keyval', key: 'fitlog-query-cache' } as const

export type PersistedCache = {
  clientState: {
    mutations: { mutationKey?: unknown[]; state: { isPaused: boolean; variables?: unknown } }[]
    queries: { queryKey: unknown[]; state: { data?: unknown } }[]
  }
} & Record<string, unknown>

/** The query cache as the app last saved it to IndexedDB (what a restart restores). */
export function readPersistedCache(page: Page): Promise<PersistedCache | undefined> {
  return page.evaluate(
    ({ db, store, key }) =>
      new Promise<PersistedCache | undefined>((resolve, reject) => {
        const open = indexedDB.open(db)
        // Never leave a store-less database behind for idb-keyval to trip on.
        open.onupgradeneeded = () => open.result.createObjectStore(store)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const conn = open.result
          if (!conn.objectStoreNames.contains(store)) return resolve(undefined)
          const get = conn.transaction(store).objectStore(store).get(key)
          get.onerror = () => reject(get.error)
          get.onsuccess = () => resolve(get.result as PersistedCache | undefined)
        }
      }),
    IDB,
  )
}

/** Overwrite the saved cache, e.g. with an older copy, as if the app had died before saving again. */
export function writePersistedCache(page: Page, value: PersistedCache): Promise<void> {
  return page.evaluate(
    ({ idb: { db, store, key }, value }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(db)
        open.onupgradeneeded = () => open.result.createObjectStore(store)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const tx = open.result.transaction(store, 'readwrite')
          tx.objectStore(store).put(value, key)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
      }),
    { idb: IDB, value },
  )
}

/** How many queued (paused) writes the saved cache holds. */
export async function persistedQueuedWrites(page: Page): Promise<number> {
  const cache = await readPersistedCache(page)
  return cache?.clientState.mutations.filter((m) => m.state.isPaused).length ?? 0
}

/** Wait until the app has saved `count` queued writes to disk, so a restart would restore them. */
export async function waitForQueuedWritesSaved(page: Page, count: number): Promise<void> {
  await expect.poll(() => persistedQueuedWrites(page), { message: 'queued writes saved to IndexedDB' }).toBe(count)
}
