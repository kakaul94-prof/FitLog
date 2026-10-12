// The app's own Ask-a-trainer client code, run under Node for the AI evals.
//
// The evals must see exactly what the browser would send and offer, so this
// re-implements nothing: it imports src/lib/trainerContext.ts (the log snapshot)
// and src/lib/trainer.ts (the bubble text and the "Remember" chip) and runs them
// against the local test stack. Python drives it over stdin/stdout:
//
//   {"command": "context", "users": [{"email": "...", "password": "..."}]}
//     -> [{"context": "...", "memory": ["..."]}]
//   {"command": "parse", "replies": ["...raw streamed reply..."]}
//     -> [{"text": "...", "remember": "..." | null}]
//   {"command": "call", "function": "middleware" | "trainer", "env": {...}, "body": {...}}
//     -> {"status": 401, "body": "..."}   (a Pages Function run with exactly that env,
//        for deploy mistakes the shared test server can't be put into)
//
// Built by build.mjs; see ai-evals/aievals/harness.py.
import './env'

import { onRequest as apiMiddleware } from '../../functions/api/_middleware'
import { onRequestPost as trainerFunction } from '../../functions/api/trainer'

import { supabase } from '@/lib/supabase'
import { displayText, parseRemember } from '@/lib/trainer'
import { buildTrainerContext } from '@/lib/trainerContext'

interface Credentials {
  email: string
  password: string
  workoutId?: string
}

type HarnessRequest =
  | { command: 'context'; users: Credentials[] }
  | { command: 'parse'; replies: string[] }
  | {
      command: 'call'
      function: 'middleware' | 'trainer'
      env: Record<string, string>
      body: unknown
    }

/** What TrainerChat.tsx posts for this user: the snapshot plus saved memory. */
async function trainerInput(user: Credentials) {
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  try {
    const context = await buildTrainerContext({ workoutId: user.workoutId })
    const { data } = await supabase.from('profiles').select('trainer_memory').maybeSingle()
    const facts = (data?.trainer_memory ?? []) as { text: string }[]
    return { context, memory: facts.map((f) => f.text) }
  } finally {
    // Local only: a global sign-out would revoke the session the Python side
    // is still using for the same user.
    await supabase.auth.signOut({ scope: 'local' })
  }
}

async function handle(request: HarnessRequest): Promise<unknown> {
  switch (request.command) {
    case 'context': {
      const out = []
      for (const user of request.users) out.push(await trainerInput(user))
      return out
    }
    case 'parse':
      return request.replies.map((raw) => ({
        text: displayText(raw),
        remember: parseRemember(raw),
      }))
    case 'call': {
      const call = new Request('http://localhost/api/trainer', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
        body: JSON.stringify(request.body),
      })
      const res =
        request.function === 'middleware'
          ? await apiMiddleware({
              request: call,
              env: request.env,
              next: async () => new Response('reached the function'),
            })
          : await trainerFunction({ request: call, env: request.env })
      return { status: res.status, body: await res.text() }
    }
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

try {
  const result = await handle(JSON.parse(await readStdin()) as HarnessRequest)
  process.stdout.write(JSON.stringify(result))
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
  process.exitCode = 1
}
