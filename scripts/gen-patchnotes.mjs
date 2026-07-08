// Generates src/data/patchNotes.generated.ts from the last 5 git commits.
// Runs automatically via the predev/prebuild npm hooks, so the Patch Notes page
// always reflects the latest deploy. On Cloudflare Pages the build env has the
// git history, so the deployed list is the true last 5. The file is git-ignored
// and regenerated every build; if git is unavailable we write an empty list so
// the build never breaks.
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const outFile = fileURLToPath(
  new URL('../src/data/patchNotes.generated.ts', import.meta.url),
)

const US = '\x1f' // unit separator between fields (safe: subjects have no newlines)

/** Drop a conventional-commit prefix (feat(scope)!: …) and capitalize. */
function cleanTitle(subject) {
  const s = subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

let notes = []
try {
  const out = execSync(
    `git log -5 --no-merges --pretty=format:%h${US}%cs${US}%s`,
    { cwd: repoRoot, encoding: 'utf8' },
  )
  notes = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, date, ...rest] = line.split(US)
      return { hash, date, title: cleanTitle(rest.join(US)) }
    })
} catch (err) {
  console.warn(
    '[gen-patchnotes] git log failed; writing empty list.',
    err?.message ?? err,
  )
}

const file =
  '// AUTO-GENERATED from the last 5 git commits by scripts/gen-patchnotes.mjs.\n' +
  '// Do not edit — regenerated on every `npm run dev` / `npm run build`.\n' +
  '/* eslint-disable */\n' +
  '\n' +
  'export interface PatchNote {\n' +
  '  hash: string\n' +
  "  /** Commit date, 'YYYY-MM-DD'. */\n" +
  '  date: string\n' +
  '  /** Commit subject, cleaned of any conventional-commit prefix. */\n' +
  '  title: string\n' +
  '}\n' +
  '\n' +
  `export const patchNotes: PatchNote[] = ${JSON.stringify(notes, null, 2)}\n`

writeFileSync(outFile, file)
console.log(
  `[gen-patchnotes] wrote ${notes.length} note(s) to src/data/patchNotes.generated.ts`,
)
