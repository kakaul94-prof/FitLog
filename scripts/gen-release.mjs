// Writes the commit being built into shared/release.ts, so the browser bundle
// and the Pages Functions tag Sentry events with the same `release` and a stack
// trace finds the source maps uploaded under it (vite.config.ts). Runs from the
// prebuild hook. Only a build that knows its commit (GITHUB_SHA in Actions,
// CF_PAGES_COMMIT_SHA in a Cloudflare Pages build) writes anything; a local
// build keeps the committed 'local' and leaves the working tree clean.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = fileURLToPath(new URL('../shared/release.ts', import.meta.url))
const sha = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA

if (!sha) {
  console.log('release: no commit in the environment; keeping "local"')
  process.exit(0)
}
if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
  console.error(`release: "${sha}" is not a commit SHA; refusing to write it`)
  process.exit(1)
}

const source = readFileSync(file, 'utf8')
const next = source.replace(/export const RELEASE = '[^']*'/, `export const RELEASE = '${sha}'`)
if (next === source && !source.includes(`'${sha}'`)) {
  console.error('release: shared/release.ts has no RELEASE line to rewrite')
  process.exit(1)
}
writeFileSync(file, next)
console.log(`release: ${sha}`)
