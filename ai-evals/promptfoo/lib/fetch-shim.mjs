// Stands in for `fetch` inside the bundled trainer function, and only there
// (esbuild's `inject`: every free `fetch` in the bundle resolves to this
// export; promptfoo's own calls, the grader's among them, use the real one).
//
// The function builds its upstream URL from env.ANTHROPIC_BASE_URL. The
// provider gives each call its own base URL under CALL_BASE, so a request
// arriving here says which call it belongs to, and goes to that call's
// handler: the real Claude API with the key swapped in, or a scripted stream.
// Any other URL goes to the real fetch untouched.

const CALL_BASE = 'http://promptfoo-call.invalid/'
const handlers = new Map()

/** A base URL for one call; requests to it go to `handler(url, init)`. */
export function registerCall(handler) {
  const id = globalThis.crypto.randomUUID()
  handlers.set(id, handler)
  return { baseUrl: `${CALL_BASE}${id}`, done: () => handlers.delete(id) }
}

export function fetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith(CALL_BASE)) return globalThis.fetch(input, init)
  const handler = handlers.get(url.slice(CALL_BASE.length).split('/')[0])
  if (!handler) return Promise.reject(new Error(`no call registered for ${url}`))
  return handler(url, init)
}
