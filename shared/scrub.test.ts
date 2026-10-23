import { describe, expect, test } from 'vitest'
import { REDACTED, redactText, redactValue, scrubBreadcrumb, scrubEvent, stripQuery } from './scrub'

// The scrubber is the only thing between a user's diary and Sentry's servers.
// Each test feeds it an event shaped like the SDKs build them, with the kind
// of data an error in FitLog can drag along, and checks what comes out.

const EMAIL = 'sam.lifter+fitlog@example.com'
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0ZDc0ZTY5Zi0wMDAwIiwiZW1haWwiOiJzYW1AZXhhbXBsZS5jb20ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
const SB_KEY = 'sb_publishable_AbCdEf123456_xYz'

/** An error event much as @sentry/react assembles one for a failed diary save. */
function diaryEvent() {
  return {
    event_id: 'abc',
    message: `Saving the entry (150 kcal) for ${EMAIL} failed with ${SB_KEY}`,
    transaction: '/diary/add?meal=snacks',
    user: { id: '4d74e69f-0000', email: EMAIL, ip_address: '203.0.113.9' },
    request: {
      url: 'https://nnhsjalccbrswqcqwpxe.supabase.co/rest/v1/diary_entries?food_name=eq.Oats&select=*',
      method: 'POST',
      query_string: 'food_name=eq.Oats',
      data: { food_name: 'Oats', meal: 'snacks', nutrients: { kcal: 150, protein: 5 } },
      cookies: { 'sb-access-token': JWT },
      headers: {
        Authorization: `Bearer ${JWT}`,
        apikey: SB_KEY,
        Cookie: 'sb-refresh-token=abc',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 7)',
        'Content-Type': 'application/json',
        Referer: 'https://fitlog-prod.pages.dev/?date=2026-10-22',
      },
    },
    exception: {
      values: [
        {
          type: 'Error',
          value: `duplicate key value violates unique constraint "diary_entries_pkey" DETAIL: Key (user_id, food_name)=(4d74e69f, Oats) for ${EMAIL} at 182.4 lb`,
          stacktrace: {
            frames: [
              { filename: 'app:///assets/index-abc123.js', function: 'saveEntry', lineno: 12, colno: 34, vars: { food: 'Oats', weightLb: 182.4 } },
              { filename: 'app:///assets/useDiary-def456.js', function: 'mutationFn', lineno: 7, colno: 2 },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      { category: 'console', level: 'log', message: `[FitLog] saving Oats for ${EMAIL}` },
      { category: 'fetch', type: 'http', data: { method: 'POST', url: 'https://x.supabase.co/rest/v1/diary_entries?select=*&food_name=eq.Oats', status_code: 409, request_body: '{"food_name":"Oats"}', response_body_size: 120 } },
      { category: 'ui.click', message: 'body > main > button[aria-label="Oats 150 calories"] > span' },
      { category: 'navigation', data: { from: '/?date=2026-10-22', to: '/diary/add?meal=snacks' } },
    ],
    extra: {
      attempt: 2,
      body: { food_name: 'Oats' },
      weightLb: 182.4,
      note: 'ate 3 eggs and 200 g of rice',
      request: { messages: [{ role: 'user', content: 'My left knee hurts' }], context: 'Lifter: 182 lb\nBench Press 185 lb x 5', memory: ['Left knee aches'] },
    },
    contexts: {
      browser: { name: 'Chrome', version: '149' },
      react: { componentStack: '\n    at DiaryPage\n    at AppLayout' },
      trainer: { snapshot: 'Lifter: 182 lb' },
    },
    tags: { where: 'error-boundary', runtime: 'browser' },
  }
}

describe('scrubEvent', () => {
  const out = scrubEvent(diaryEvent())
  const text = JSON.stringify(out)

  test('returns the same object, scrubbed in place (it is the whole beforeSend)', () => {
    const event = diaryEvent()
    expect(scrubEvent(event)).toBe(event)
  })

  test('nothing personal survives anywhere in the payload', () => {
    expect(text).not.toContain(EMAIL)
    expect(text).not.toContain('example.com')
    expect(text).not.toContain(JWT)
    expect(text).not.toContain('eyJhbGci')
    expect(text).not.toContain(SB_KEY)
    expect(text).not.toContain('Oats')
    expect(text).not.toContain('182')
    expect(text).not.toContain('150')
    expect(text).not.toContain('eggs')
    expect(text).not.toContain('knee')
    expect(text).not.toContain('Bench Press')
    expect(text).not.toContain('203.0.113.9')
    expect(text).not.toContain('2026-10-22')
  })

  test('the user object is gone entirely', () => {
    expect(out.user).toBeUndefined()
  })

  test('the request keeps its method and a path, and loses body, query, cookies and auth headers', () => {
    expect(out.request).toEqual({
      url: 'https://nnhsjalccbrswqcqwpxe.supabase.co/rest/v1/diary_entries',
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 7)',
        'Content-Type': 'application/json',
        Referer: 'https://fitlog-prod.pages.dev/',
      },
    })
    expect(out.transaction).toBe('/diary/add')
  })

  test('the stack trace stays readable: files, functions and lines intact, locals removed', () => {
    const frames = out.exception.values[0].stacktrace.frames
    expect(frames).toEqual([
      { filename: 'app:///assets/index-abc123.js', function: 'saveEntry', lineno: 12, colno: 34 },
      { filename: 'app:///assets/useDiary-def456.js', function: 'mutationFn', lineno: 7, colno: 2 },
    ])
    expect(out.exception.values[0].type).toBe('Error')
    expect(out.exception.values[0].value).toBe(
      `duplicate key value violates unique constraint "diary_entries_pkey" DETAIL: Key (user_id, food_name)=(${REDACTED}) for [email] at [quantity]`,
    )
  })

  test('breadcrumbs: console dropped, fetch URL and body stripped, click labels and routes redacted', () => {
    expect(out.breadcrumbs).toEqual([
      { category: 'fetch', type: 'http', data: { method: 'POST', url: 'https://x.supabase.co/rest/v1/diary_entries', status_code: 409, response_body_size: 120 } },
      { category: 'ui.click', message: `body > main > button[aria-label="${REDACTED}"] > span` },
      { category: 'navigation', data: { from: '/', to: '/diary/add' } },
    ])
  })

  test('extras and contexts keep harmless keys and lose anything that smells like logged data', () => {
    expect(out.extra).toEqual({ attempt: 2, body: REDACTED, weightLb: REDACTED, note: REDACTED, request: { messages: REDACTED, context: REDACTED, memory: REDACTED } })
    expect(out.contexts).toEqual({
      browser: { name: 'Chrome', version: '149' },
      react: { componentStack: '\n    at DiaryPage\n    at AppLayout' },
      trainer: { snapshot: REDACTED },
    })
    expect(out.tags).toEqual({ where: 'error-boundary', runtime: 'browser' })
  })

  test('a message-only event and a logentry are redacted too, and params dropped', () => {
    const e = scrubEvent({ message: `token ${JWT} for ${EMAIL}`, logentry: { message: 'weight %s', params: [182.4] } })
    expect(e.message).toBe('token [jwt] for [email]')
    expect(e.logentry).toEqual({ message: 'weight %s' })
  })

  test('a Functions event (Cloudflare shape, breadcrumbs under values) is handled the same way', () => {
    const e = scrubEvent({
      request: { url: 'https://fitlog-prod.pages.dev/api/trainer?x=1', headers: { authorization: `Bearer ${JWT}`, 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'ua' } },
      breadcrumbs: { values: [{ category: 'console', message: 'secret' }, { category: 'http', data: { url: 'https://api.anthropic.com/v1/messages?beta=1', method: 'POST' } }] },
      exception: { values: [{ type: 'TypeError', value: 'Cannot read properties of undefined' }] },
    })
    expect(e.request).toEqual({ url: 'https://fitlog-prod.pages.dev/api/trainer', headers: { 'user-agent': 'ua' } })
    expect(e.breadcrumbs).toEqual({ values: [{ category: 'http', data: { url: 'https://api.anthropic.com/v1/messages', method: 'POST' } }] })
    expect(e.exception.values[0].value).toBe('Cannot read properties of undefined')
  })

  test('an empty event passes through untouched', () => {
    expect(scrubEvent({})).toEqual({})
  })
})

describe('redactText keeps what makes an error useful', () => {
  test.each([
    'TypeError: Failed to fetch',
    'HTTP 500 from /api/trainer after 20000 ms',
    'status 404 for route /lift/trainer/memory',
    "Cannot read properties of undefined (reading 'map')",
    'ChunkLoadError: Loading chunk 12 failed',
    'PGRST202: Could not find the function public.record_goal_change',
  ])('leaves "%s" alone', (s) => {
    expect(redactText(s)).toBe(s)
  })

  test.each([
    [`user ${EMAIL} signed in`, 'user [email] signed in'],
    [`Bearer ${JWT}`, `Bearer ${REDACTED}`],
    [`key ${SB_KEY} rejected`, 'key [key] rejected'],
    [`jwt ${JWT} expired`, 'jwt [jwt] expired'],
    ['weighed 182.4 lb, ate 650 kcal and 30 g protein, 2,5 kg', 'weighed [quantity], ate [quantity] and [quantity] protein, [quantity]'],
    ['Key (date, meal)=(2026-10-22, snacks) already exists', `Key (date, meal)=(${REDACTED}) already exists`],
  ])('redacts %s', (input, expected) => {
    expect(redactText(input)).toBe(expected)
  })
})

describe('the smaller pieces', () => {
  test('stripQuery', () => {
    expect(stripQuery('https://a.b/c?d=1#e')).toBe('https://a.b/c')
    expect(stripQuery('/diary/add#top')).toBe('/diary/add')
    expect(stripQuery('/plain')).toBe('/plain')
  })

  test('scrubBreadcrumb drops console and keeps the shape of the rest', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'anything' })).toBeNull()
    expect(scrubBreadcrumb({ category: 'xhr', data: { method: 'GET', url: '/rest/v1/foods?name=ilike.*oats*', input: ['/rest/v1/foods'], status_code: 200 } })).toEqual({
      category: 'xhr',
      data: { method: 'GET', url: '/rest/v1/foods', status_code: 200 },
    })
  })

  test('redactValue is bounded in depth and never throws on odd values', () => {
    let deep: Record<string, unknown> = { leaf: 'x@y.io' }
    for (let i = 0; i < 10; i++) deep = { inner: deep }
    expect(JSON.stringify(redactValue(deep))).toContain(REDACTED)
    expect(redactValue(null)).toBeNull()
    expect(redactValue(42)).toBe(42)
    expect(redactValue([`a ${EMAIL}`, { password: 'x' }])).toEqual(['a [email]', { password: REDACTED }])
  })
})
