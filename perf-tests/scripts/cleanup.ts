// Deletes every @perf.test user on the local stack, with all their rows. Each
// run deletes its own users in teardown; this sweep covers a run that was
// stopped first. run.sh runs it after every scenario and as `run.sh cleanup`.
import { deleteUser, listUsers } from '../lib/admin.ts'
import { loadEnv } from '../lib/env.ts'
import { PERF_EMAIL_DOMAIN } from '../lib/seed.ts'

export const options = { vus: 1, iterations: 1 }

const env = loadEnv()
const PAGE = 1000

export default function (): void {
  let removed = 0
  let failed = 0
  let page = 1
  for (let guard = 0; guard < 500; guard++) {
    const users = listUsers(env, page, PAGE)
    const mine = users.filter((u) => (u.email ?? '').endsWith(PERF_EMAIL_DOMAIN))
    for (const u of mine) {
      if ([200, 204, 404].includes(deleteUser(env, u.id))) removed++
      else failed++
    }
    if (users.length < PAGE) break
    if (!mine.length) page++ // this page is untouched, so the next one hasn't shifted
  }
  console.log(`cleanup: removed ${removed} ${PERF_EMAIL_DOMAIN} user(s)${failed ? `, ${failed} could not be deleted` : ''}`)
}
