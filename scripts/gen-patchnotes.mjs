// Generates src/data/patchNotes.generated.ts from the last 5 pushes.
// Git records commits, not pushes, so we approximate a "push" as a run of
// commits made close together in time (see PUSH_GAP_MINUTES) — roughly one
// deploy's worth of work. Runs automatically via the predev/prebuild npm hooks,
// so the Patch Notes page always reflects the latest deploy. Cloudflare Pages
// (like most CI) does a shallow clone (depth 1), so we deepen the history first
// — otherwise git log would only see the HEAD commit. The file is git-ignored
// and regenerated every build; if git is unavailable we write an empty list so
// the build never breaks.
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const outFile = fileURLToPath(
  new URL('../src/data/patchNotes.generated.ts', import.meta.url),
)

// Commits whose commit-times fall within this many minutes of each other are
// treated as one push. Tuned so a burst of related commits reads as a single
// entry while separate work sessions stay apart. Heuristic — git keeps no real
// record of push boundaries.
const PUSH_GAP_MINUTES = 120
const PUSHES = 5

const US = '\x1f' // unit separator between fields (safe: subjects have no newlines)

/** Drop a conventional-commit prefix (feat(scope)!: …) and capitalize. */
function cleanTitle(subject) {
  const s = subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * If the checkout is a shallow clone (Cloudflare Pages / most CI use depth 1),
 * deepen it so we can see more than the HEAD commit. Best-effort: any failure —
 * a full clone, no network/remote, or an old git without
 * --is-shallow-repository — is ignored, and we fall back to whatever history is
 * present (never worse than before, and the build never breaks).
 */
function ensureHistory() {
  try {
    const shallow = execSync('git rev-parse --is-shallow-repository', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()
    if (shallow === 'true') {
      execSync('git fetch --deepen=60', { cwd: repoRoot, stdio: 'ignore' })
    }
  } catch {
    // leave history as-is
  }
}

let pushes = []
try {
  ensureHistory()
  // Pull well past 5 pushes' worth of commits, then group. %ct = commit time
  // (unix seconds) for the gap math; %cs = commit date (YYYY-MM-DD) to display.
  const out = execSync(
    `git log -50 --no-merges --pretty=format:%h${US}%ct${US}%cs${US}%s`,
    { cwd: repoRoot, encoding: 'utf8' },
  )
  const commits = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, ts, date, ...rest] = line.split(US)
      return { hash, ts: Number(ts), date, title: cleanTitle(rest.join(US)) }
    })

  // Commits arrive newest-first; start a new push whenever the gap to the
  // previous (adjacent) commit exceeds the threshold.
  const groups = []
  for (const c of commits) {
    const group = groups[groups.length - 1]
    const prev = group?.commits[group.commits.length - 1]
    if (prev && prev.ts - c.ts <= PUSH_GAP_MINUTES * 60) {
      group.commits.push(c)
    } else {
      groups.push({ date: c.date, commits: [c] })
    }
  }

  pushes = groups.slice(0, PUSHES).map((g) => ({
    date: g.date,
    notes: g.commits.map(({ hash, title }) => ({ hash, title })),
  }))
} catch (err) {
  console.warn(
    '[gen-patchnotes] git log failed; writing empty list.',
    err?.message ?? err,
  )
}

const file =
  '// AUTO-GENERATED from the last 5 pushes by scripts/gen-patchnotes.mjs.\n' +
  '// Do not edit — regenerated on every `npm run dev` / `npm run build`.\n' +
  '/* eslint-disable */\n' +
  '\n' +
  'export interface PatchNote {\n' +
  '  hash: string\n' +
  '  /** Commit subject, cleaned of any conventional-commit prefix. */\n' +
  '  title: string\n' +
  '}\n' +
  '\n' +
  'export interface PatchPush {\n' +
  "  /** Date of the newest commit in the push, 'YYYY-MM-DD'. */\n" +
  '  date: string\n' +
  '  /** Commits in the push, newest first. */\n' +
  '  notes: PatchNote[]\n' +
  '}\n' +
  '\n' +
  `export const patchNotes: PatchPush[] = ${JSON.stringify(pushes, null, 2)}\n`

writeFileSync(outFile, file)
const commitCount = pushes.reduce((n, p) => n + p.notes.length, 0)
console.log(
  `[gen-patchnotes] wrote ${pushes.length} push(es) / ${commitCount} commit(s) to src/data/patchNotes.generated.ts`,
)
