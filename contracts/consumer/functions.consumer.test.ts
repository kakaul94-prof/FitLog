/**
 * What the FitLog frontend needs from its Cloudflare Pages Functions (/api/*),
 * proven by running the app's OWN wrappers (src/lib/trainer.ts, scanPlate.ts)
 * against a recording stand-in, then written to
 * contracts/fitlog-web--pages-functions.json for
 * contracts/provider/functions.verify.test.ts to replay against the real
 * handlers in functions/api/.
 *
 * Covered: the Ask-a-trainer stream and every error the chat shows (400, 401,
 * 502, 503), and the meal-photo scan with its 400, 401, 422 and 503.
 */

import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { Recorder } from '../support/recorder'
import { t } from '../support/schema'
import { fakeJwt } from '../support/jwt'
import { contractJson } from '../support/contractFile'
import type { JsonSchema } from '../support/types'

// prepareImage draws on a canvas, which Node has not. The contract is about the
// bytes the wrapper sends, so it gets a fixed data URL (or nothing, to reach the
// provider's "no image" refusal).
vi.mock('@/lib/image', () => ({
  prepareImage: async (file: File) =>
    file.name === 'nothing.jpg' ? '' : 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/contract',
}))

import { supabase } from '@/lib/supabase'
import { askTrainer } from '@/lib/trainer'
import { scanPlate } from '@/lib/scanPlate'

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const USER_ID = 'a1b2c3d4-0000-4000-8000-000000000001'
const EMAIL = 'alice@contract.test'
const EXPIRES_AT = Math.floor(Date.now() / 1000) + 3600
const ACCESS_TOKEN = fakeJwt({ sub: USER_ID, email: EMAIL, exp: EXPIRES_AT })

const recorder = new Recorder('pages-functions', { accessToken: ACCESS_TOKEN, anonKey: ANON_KEY })
recorder.install()
afterEach(() => recorder.verify())

// Every /api call forwards the Supabase session (src/lib/apiAuth.ts), so the
// file starts by signing in. That call belongs to the Supabase contract, not
// this one: matched and answered, never recorded here.
beforeAll(async () => {
  recorder.expect({
    id: 'setup.sign-in',
    description: 'Sign in (set-up only)',
    consumer: 'set-up',
    providerStates: [],
    record: false,
    request: {
      method: 'POST',
      path: '/auth/v1/token',
      query: { grant_type: 'password' },
      headers: { apikey: '{{anonKey}}' },
      body: t.object({ email: t.text(), password: t.text() }),
    },
    response: {
      status: 200,
      schema: null,
      body: {
        access_token: ACCESS_TOKEN,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: EXPIRES_AT,
        refresh_token: 'contract-refresh-token',
        user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: EMAIL },
      },
    },
  })
  const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: 'contract-password-1' })
  if (error) throw error
  recorder.verify()
})

const SIGNED_IN = { name: 'a signed-in user' }
const API_HEADERS = { authorization: 'Bearer {{accessToken}}', 'content-type': 'application/json' }
const JSON_RESPONSE = { 'content-type': 'application/json' }
/** Every failure the UI shows comes back as { error: <message for the user> }. */
const ERROR_BODY = t.object({ error: t.text() })

// -- Ask a trainer ------------------------------------------------------------------

const TRAINER_REQUEST: JsonSchema = t.object(
  {
    messages: t.array(
      t.object({ role: t.oneOf('user', 'assistant'), content: t.text() }, { closed: true }),
    ),
    context: t.string(),
    memory: t.array(t.string()),
  },
  { closed: true },
)
const QUESTION = { role: 'user' as const, content: 'How do I add weight to my bench?' }
const CONTEXT = 'BENCH PRESS: 185 lb x 5, 5, 5 on 2026-10-19'
const MEMORY = ['Left knee aches on deep squats']
const ANSWER_CHUNKS = [
  'Add 5 lb next session ',
  'and keep the reps at 5.',
  '\n\n[[REMEMBER: Trains at home with dumbbells only]]',
]
const ANSWER = ANSWER_CHUNKS.join('')

function trainerError(opts: {
  id: string
  description: string
  status: number
  state: { name: string; params?: Record<string, string> }
  message: string
}) {
  return {
    id: opts.id,
    description: opts.description,
    consumer: 'src/lib/trainer.ts askTrainer(): throws data.error, shown in the chat bubble',
    providerStates:
      opts.state.name === 'the session has expired'
        ? [opts.state]
        : opts.state.name === SIGNED_IN.name
          ? [SIGNED_IN]
          : [SIGNED_IN, opts.state],
    request: { method: 'POST' as const, path: '/api/trainer', headers: API_HEADERS, body: TRAINER_REQUEST },
    response: { status: opts.status, headers: JSON_RESPONSE, schema: ERROR_BODY, body: { error: opts.message } },
  }
}

describe('POST /api/trainer', () => {
  test('trainer.ask: the answer streams as plain text; the memory marker is parsed out', async () => {
    recorder.expect({
      id: 'trainer.ask',
      description: 'Ask the trainer a question',
      consumer: 'src/lib/trainer.ts askTrainer(): reads the text stream, strips [[REMEMBER: …]]',
      providerStates: [SIGNED_IN, { name: 'Claude answers', params: { text: ANSWER } }],
      request: { method: 'POST', path: '/api/trainer', headers: API_HEADERS, body: TRAINER_REQUEST },
      response: {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        schema: t.text(),
        body: ANSWER,
        chunks: ANSWER_CHUNKS,
      },
    })

    const shown: string[] = []
    const reply = await askTrainer({
      messages: [QUESTION],
      context: CONTEXT,
      memory: MEMORY,
      onText: (text) => shown.push(text),
    })

    expect(reply).toEqual({
      text: 'Add 5 lb next session and keep the reps at 5.',
      remember: 'Trains at home with dumbbells only',
    })
    expect(shown.length).toBeGreaterThan(1) // it arrived in pieces
    expect(shown.at(-1)).toBe(reply.text)
  })

  test('trainer.ask-nothing: 400 when there is no question', async () => {
    recorder.expect(
      trainerError({
        id: 'trainer.ask-nothing',
        description: 'Ask with no question',
        status: 400,
        state: SIGNED_IN,
        message: 'Ask a question first.',
      }),
    )
    await expect(
      askTrainer({ messages: [], context: CONTEXT, memory: [], onText: () => {} }),
    ).rejects.toThrow('Ask a question first.')
  })

  test('trainer.ask-signed-out: 401 when the session is no longer valid', async () => {
    recorder.expect(
      trainerError({
        id: 'trainer.ask-signed-out',
        description: 'Ask with a session the provider no longer accepts',
        status: 401,
        state: { name: 'the session has expired' },
        message: 'Your session has expired. Sign in again.',
      }),
    )
    await expect(
      askTrainer({ messages: [QUESTION], context: CONTEXT, memory: MEMORY, onText: () => {} }),
    ).rejects.toThrow('Your session has expired. Sign in again.')
  })

  test('trainer.ask-claude-down: 502 when Claude fails', async () => {
    recorder.expect(
      trainerError({
        id: 'trainer.ask-claude-down',
        description: 'Ask while Claude is failing',
        status: 502,
        state: { name: 'Claude is down' },
        message: 'Claude is having a moment. Try again shortly. (code: upstream)',
      }),
    )
    await expect(
      askTrainer({ messages: [QUESTION], context: CONTEXT, memory: MEMORY, onText: () => {} }),
    ).rejects.toThrow('Claude is having a moment. Try again shortly. (code: upstream)')
  })

  test('trainer.ask-not-configured: 503 when the deployment has no AI key', async () => {
    recorder.expect(
      trainerError({
        id: 'trainer.ask-not-configured',
        description: 'Ask when the deployment has no AI key',
        status: 503,
        state: { name: 'the AI key is not configured' },
        message: "The trainer isn't set up correctly right now. (code: no-key)",
      }),
    )
    await expect(
      askTrainer({ messages: [QUESTION], context: CONTEXT, memory: MEMORY, onText: () => {} }),
    ).rejects.toThrow("The trainer isn't set up correctly right now. (code: no-key)")
  })
})

// -- meal-photo scan ----------------------------------------------------------------

const SCAN_REQUEST = t.object({ image: t.string() }, { closed: true })
const PLATE = {
  items: [
    { name: 'Grilled chicken breast', grams: 150, kcal: 248, protein: 46, carb: 0, fat: 5 },
    { name: 'White rice', grams: 200, kcal: 260, protein: 5, carb: 57, fat: 0.5 },
  ],
  note: 'Assumed about a teaspoon of oil on the chicken.',
}
const PLATE_SCHEMA = t.object(
  {
    items: t.array(
      t.object({
        name: t.text(),
        grams: t.number(),
        kcal: t.number(),
        protein: t.number(),
        carb: t.number(),
        fat: t.number(),
      }),
    ),
    note: t.string(),
  },
  { optional: ['note'] },
)
const photo = (name = 'plate.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' })

function scanError(opts: {
  id: string
  description: string
  status: number
  states: { name: string; params?: Record<string, string> }[]
  message: string
}) {
  return {
    id: opts.id,
    description: opts.description,
    consumer: 'src/lib/scanPlate.ts scanPlate(): throws data.error, shown on the scan screen',
    providerStates: opts.states,
    request: { method: 'POST' as const, path: '/api/scan-plate', headers: API_HEADERS, body: SCAN_REQUEST },
    response: { status: opts.status, headers: JSON_RESPONSE, schema: ERROR_BODY, body: { error: opts.message } },
  }
}

describe('POST /api/scan-plate', () => {
  test('scan-plate.scan: the foods on the plate, with the nutrition of each portion', async () => {
    recorder.expect({
      id: 'scan-plate.scan',
      description: 'Scan a meal photo',
      consumer: 'src/lib/scanPlate.ts scanPlate(): reads items[].name/grams/kcal/protein/carb/fat and note',
      providerStates: [SIGNED_IN, { name: 'Claude answers', params: { text: JSON.stringify(PLATE) } }],
      request: { method: 'POST', path: '/api/scan-plate', headers: API_HEADERS, body: SCAN_REQUEST },
      response: { status: 200, headers: JSON_RESPONSE, schema: PLATE_SCHEMA, body: PLATE },
    })

    const plate = await scanPlate(photo())

    expect(plate).toEqual({
      items: [
        { name: 'Grilled chicken breast', grams: 150, nutrients: { kcal: 248, protein: 46, fat: 5 } },
        { name: 'White rice', grams: 200, nutrients: { kcal: 260, protein: 5, carb: 57, fat: 0.5 } },
      ],
      note: 'Assumed about a teaspoon of oil on the chicken.',
    })
  })

  test('scan-plate.scan-no-image: 400 when no image was sent', async () => {
    recorder.expect(
      scanError({
        id: 'scan-plate.scan-no-image',
        description: 'Scan with an empty image',
        status: 400,
        states: [SIGNED_IN],
        message: 'No image provided.',
      }),
    )
    await expect(scanPlate(photo('nothing.jpg'))).rejects.toThrow('No image provided.')
  })

  test('scan-plate.scan-signed-out: 401 when the session is no longer valid', async () => {
    recorder.expect(
      scanError({
        id: 'scan-plate.scan-signed-out',
        description: 'Scan with a session the provider no longer accepts',
        status: 401,
        states: [{ name: 'the session has expired' }],
        message: 'Your session has expired. Sign in again.',
      }),
    )
    await expect(scanPlate(photo())).rejects.toThrow('Your session has expired. Sign in again.')
  })

  test('scan-plate.scan-unreadable: 422 when the model could not read the plate', async () => {
    recorder.expect(
      scanError({
        id: 'scan-plate.scan-unreadable',
        description: 'Scan a photo the model cannot make sense of',
        status: 422,
        states: [SIGNED_IN, { name: 'Claude answers', params: { text: 'Sorry, I cannot see any food here.' } }],
        message: "Couldn't read the meal. Try a clearer, well-lit photo.",
      }),
    )
    await expect(scanPlate(photo())).rejects.toThrow("Couldn't read the meal. Try a clearer, well-lit photo.")
  })

  test('scan-plate.scan-not-configured: 503 when the deployment has no AI key', async () => {
    recorder.expect(
      scanError({
        id: 'scan-plate.scan-not-configured',
        description: 'Scan when the deployment has no AI key',
        status: 503,
        states: [SIGNED_IN, { name: 'the AI key is not configured' }],
        message: 'Meal scanning is not configured (no API key).',
      }),
    )
    await expect(scanPlate(photo())).rejects.toThrow('Meal scanning is not configured (no API key).')
  })
})

// -- the contract file -------------------------------------------------------------

const ALL = [
  'trainer.ask',
  'trainer.ask-nothing',
  'trainer.ask-signed-out',
  'trainer.ask-claude-down',
  'trainer.ask-not-configured',
  'scan-plate.scan',
  'scan-plate.scan-no-image',
  'scan-plate.scan-signed-out',
  'scan-plate.scan-unreadable',
  'scan-plate.scan-not-configured',
]

test('contracts/fitlog-web--pages-functions.json is up to date', async () => {
  expect(
    recorder.interactions.map((i) => i.id),
    'fix the failing consumer tests above first; the file is only written from a full set',
  ).toEqual(ALL)
  await expect(
    contractJson(recorder.contract('contracts/consumer/functions.consumer.test.ts')),
  ).toMatchFileSnapshot('../fitlog-web--pages-functions.json')
})
