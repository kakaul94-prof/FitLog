// One switchboard for `fetch` in the offline contract tests. Installed for the
// whole `contracts` project (vitest setupFiles), so no test, and no app code a
// test pulls in, can reach a real server: anything nobody scripted throws.

import { vi } from 'vitest'

export type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

let handler: FetchHandler | null = null

export function installNetworkGuard(): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    if (!handler)
      return Promise.reject(
        new Error(`Unexpected network call in a contract test: ${describeRequest(input, init)}`),
      )
    return handler(input, init)
  })
}

/** Route every fetch through `fn` (null restores the "nothing allowed" default). */
export function setFetchHandler(fn: FetchHandler | null): void {
  handler = fn
}

export function describeRequest(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return `${method.toUpperCase()} ${url}`
}
