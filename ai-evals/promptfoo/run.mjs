#!/usr/bin/env node
// The promptfoo layer's one entry point (the npm eval:pf:* scripts call it).
//
//   node run.mjs eval [--set golden|redteam|canary] [--models] [--repeat N]
//                     [--only id ...] [--category c] [--max-usd X] [--yes]
//   node run.mjs calibration [--repeat N] [--yes]     promptfoo's grader on the 15 labelled replies
//   node run.mjs compare <run dir> [--calibration <dir>] [--yes]
//                                                     the custom judge on the same replies (Python)
//   node run.mjs stub                                 the CI subset: no key, no cost
//   node run.mjs replay <live run dir> ...            the custom suite's saved replies, rule checks only
//   node run.mjs contexts                             rebuild contexts.json (needs the local stack)
//   node run.mjs view                                 promptfoo's web viewer on the local results
//
// A live command first prints what it will run and what it can cost (expected,
// from the token counts of the custom suite's last full run, and the worst
// case, every reply at its token ceiling), refuses a worst case over
// --max-usd, and spends nothing without --yes.
//
// Results: reports/promptfoo/<run>/ (gitignored): results.json and
// report.html from promptfoo, summary.json and summary.md from this script.
// promptfoo's own database stays in reports/promptfoo/.promptfoo, never in
// the home directory; telemetry, update checks and sharing are off.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { PRICES, costOf } from './provider.mjs'
import { AI_EVALS, REPO, loadContexts, localToday } from './lib/contexts.mjs'
import { GRADER_MODEL, readResults, renderMarkdown, summarize } from './lib/summary.mjs'
import { buildTests } from './tests.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPORTS = join(REPO, 'reports', 'promptfoo')
const KEY_VAR = 'ANTHROPIC_API_KEY_EVALS'
const TRAINER_MAX_TOKENS = 700 // functions/api/trainer.ts
const GRADER_MAX_TOKENS = 1024 // promptfooconfig.yaml
const CHARS_PER_TOKEN = 3 // conservative (English is about 4), as in aievals/live.py
const MODELS = { 'haiku-4-5': 'claude-haiku-4-5', 'haiku-5-5': 'claude-haiku-5-5' }
// Expected tokens per call. Haiku 4.5 and the grader's model are from the
// custom suite's last full live run (reports/ai-evals-live/20261013T010202Z:
// 174 trainer calls, 2,472 in / 133 out on average; its judge 950 / 86).
// promptfoo's grading prompt is longer than the custom judge's, so its input
// is estimated higher. Haiku 5.5 has no run yet: ~30% more input tokens for
// the same text (its tokenizer) and room for thinking in the output.
const EXPECTED = {
  'claude-haiku-4-5': { input: 2472, output: 133 },
  'claude-haiku-5-5': { input: 3215, output: 350 },
  grader: { input: 1400, output: 200 },
}

const usd = (x) => `$${x.toFixed(2)}`

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

function loadKey() {
  const fromEnv = process.env[KEY_VAR]?.trim()
  if (fromEnv) return fromEnv
  const file = join(AI_EVALS, '.env.live')
  if (!existsSync(file)) return null
  // utf-8 with or without a byte-order mark (Notepad and PowerShell add one).
  for (const line of readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const [name, ...rest] = line.split('=')
    if (name.trim() === KEY_VAR && rest.join('=').trim()) return rest.join('=').trim().replace(/^["']|["']$/g, '')
  }
  return null
}

function promptfooEnv(extra = {}) {
  const env = {
    ...process.env,
    PROMPTFOO_CONFIG_DIR: join(REPORTS, '.promptfoo'),
    PROMPTFOO_DISABLE_TELEMETRY: '1',
    PROMPTFOO_DISABLE_UPDATE: '1',
    PROMPTFOO_DISABLE_SHARING: '1',
    PROMPTFOO_CACHE_ENABLED: 'false',
    ...extra,
  }
  // The key reaches promptfoo only as this run's environment, and only for a live run.
  if (!extra.ANTHROPIC_API_KEY) delete env.ANTHROPIC_API_KEY
  return env
}

function promptfoo(args, env) {
  const pkg = join(HERE, 'node_modules', 'promptfoo', 'package.json')
  if (!existsSync(pkg)) fail('promptfoo is not installed: npm run eval:pf:install')
  const { bin } = JSON.parse(readFileSync(pkg, 'utf8'))
  const cli = join(HERE, 'node_modules', 'promptfoo', typeof bin === 'string' ? bin : bin.promptfoo)
  const done = spawnSync(process.execPath, [cli, ...args], { cwd: HERE, env, stdio: 'inherit' })
  return done.status ?? 1
}

/** The fixed rules' length, from the function's source (the SYSTEM template literal). */
function rulesChars() {
  const source = readFileSync(join(REPO, 'functions', 'api', 'trainer.ts'), 'utf8')
  return /const SYSTEM = `([\s\S]*?)`\n/.exec(source)?.[1].length ?? 12_000
}

function costPlan(tests, models, repeat) {
  const rules = rulesChars()
  const fixture = loadContexts()
  let expected = 0
  let worst = 0
  let trainerCalls = 0
  let graderCalls = 0
  for (const t of tests) {
    const entry = fixture.entries[t.vars.context_key]
    const promptChars =
      rules + entry.context.length + entry.memory.join('').length + t.vars.ask.length + t.vars.history.length + 400
    const rubrics = t.assert.filter((a) => a.type === 'llm-rubric')
    for (const model of models) {
      trainerCalls += repeat
      graderCalls += rubrics.length * repeat
      expected += repeat * costOf(model, EXPECTED[model].input, EXPECTED[model].output)
      worst += repeat * costOf(model, promptChars / CHARS_PER_TOKEN, TRAINER_MAX_TOKENS)
      for (const r of rubrics) {
        expected += repeat * costOf(GRADER_MODEL, EXPECTED.grader.input, EXPECTED.grader.output)
        const graded = 2500 + r.value.length + t.vars.ask.length + TRAINER_MAX_TOKENS * 4 + (t.vars.judge_log?.length ?? 0)
        worst += repeat * costOf(GRADER_MODEL, graded / CHARS_PER_TOKEN, GRADER_MAX_TOKENS)
      }
    }
  }
  return { expected, worst, trainerCalls, graderCalls }
}

function runId(suffix) {
  return `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z-${suffix}`
}

function writeSummary(dir, title, notes) {
  const results = readResults(join(dir, 'results.json'))
  const providers = summarize(results)
  const markdown = renderMarkdown(title, providers, notes)
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ title, notes, providers }, null, 1))
  writeFileSync(join(dir, 'summary.md'), markdown)
  process.stdout.write(`\n${markdown}\nResults: ${dir}\n`)
  return { results, providers }
}

function evalCommand(opts) {
  const set = opts.set ?? 'golden'
  const labels = opts.models ? Object.keys(MODELS) : ['haiku-4-5']
  const models = labels.map((l) => MODELS[l])
  const repeat = Number(opts.repeat ?? 1)
  if (!(repeat >= 1 && repeat <= 5)) fail('--repeat must be 1 to 5')
  const today = localToday()
  const selection = { set, only: opts.only ?? [], category: opts.category ?? '' }
  const tests = buildTests({ ...selection, today })
  const plan = costPlan(tests, models, repeat)
  const maxUsd = Number(opts['max-usd'] ?? 3)
  process.stdout.write(
    `promptfoo, live: ${tests.length} cases (${set}${selection.category ? `, ${selection.category}` : ''}) x ${labels.join(' + ')} x ${repeat} run(s)\n` +
      `  ${plan.trainerCalls} trainer calls, ${plan.graderCalls} grader calls (${GRADER_MODEL})\n` +
      `  expected cost about ${usd(plan.expected)}; worst case ${usd(plan.worst)} (every reply at its token ceiling); cap ${usd(maxUsd)}\n`,
  )
  if (plan.worst > maxUsd) fail(`Refusing to start: the worst case is over --max-usd ${usd(maxUsd)}.`)
  if (!opts.yes) {
    process.stdout.write('Nothing spent. Add --yes to run it (npm run eval:pf -- --yes).\n')
    return 0
  }
  const key = loadKey()
  if (!key) fail(`No key: put ${KEY_VAR}=<key> in ai-evals/.env.live (gitignored) or the environment.`)

  const dir = join(REPORTS, runId(`${set}${opts.models ? '-models' : ''}`))
  mkdirSync(dir, { recursive: true })
  const status = promptfoo(
    [
      'eval',
      '-c', 'promptfooconfig.yaml',
      '-o', join(dir, 'results.json'),
      '-o', join(dir, 'report.html'),
      '--no-cache',
      '--no-progress-bar',
      '--no-share',
      '-j', String(opts.concurrency ?? 4),
      '--repeat', String(repeat),
      '--filter-providers', `^(${labels.join('|')})$`,
    ],
    promptfooEnv({
      ANTHROPIC_API_KEY: key,
      PF_ALLOW_LIVE: '1',
      // Retries count against it, as in the custom suite's proxy.
      PF_MAX_CALLS: String(Math.ceil(plan.trainerCalls * 1.2) + 5),
      PF_SET: set,
      PF_ONLY: selection.only.join(' '),
      PF_CATEGORY: selection.category,
      PF_TODAY: today,
    }),
  )
  if (!existsSync(join(dir, 'results.json'))) fail(`promptfoo wrote no results (exit ${status})`)
  const { providers } = writeSummary(dir, `promptfoo: ${set} set, ${labels.join(' vs ')}, ${repeat} run(s)`, [
    `Logs rendered for ${today} from contexts.json (built ${loadContexts().generated}).`,
    'Rule checks: the share of scored tests whose rule assertions all passed; judged: the same for llm-rubric, grader errors left out.',
  ])
  const allPassed = Object.values(providers).every((p) => p.errors === 0 && p.passed === p.scored)
  return allPassed ? 0 : 1
}

function calibrationCommand(opts) {
  const repeat = Number(opts.repeat ?? 2)
  const items = 15
  const graded = (2500 + 3000 + 700 * 4) / CHARS_PER_TOKEN
  const expected = items * repeat * costOf(GRADER_MODEL, EXPECTED.grader.input, EXPECTED.grader.output)
  const worst = items * repeat * costOf(GRADER_MODEL, graded, GRADER_MAX_TOKENS)
  process.stdout.write(
    `promptfoo, calibration: ${items} labelled replies x ${repeat} grader runs (${GRADER_MODEL}), no trainer calls\n` +
      `  expected cost about ${usd(expected)}; worst case ${usd(worst)}\n`,
  )
  if (!opts.yes) {
    process.stdout.write('Nothing spent. Add --yes to run it.\n')
    return 0
  }
  const key = loadKey()
  if (!key) fail(`No key: put ${KEY_VAR}=<key> in ai-evals/.env.live (gitignored) or the environment.`)
  const dir = join(REPORTS, runId('calibration'))
  mkdirSync(dir, { recursive: true })
  promptfoo(
    ['eval', '-c', 'promptfooconfig.calibration.yaml', '-o', join(dir, 'results.json'), '-o', join(dir, 'report.html'),
      '--no-cache', '--no-progress-bar', '--no-share', '-j', '4', '--repeat', String(repeat)],
    promptfooEnv({ ANTHROPIC_API_KEY: key }),
  )
  if (!existsSync(join(dir, 'results.json'))) fail('promptfoo wrote no results')
  writeSummary(dir, `promptfoo grader on the calibration replies, ${repeat} run(s)`, [
    'Pass here means the grader passed the reply; whether that matches the hand label is scored by `npm run eval:pf:compare`.',
  ])
  return 0
}

/** The custom suite's live runs, replayed through promptfoo's rule assertions: no model, no cost. */
function replayCommand(dirs) {
  if (!dirs.length) fail('usage: node run.mjs replay <reports/ai-evals-live/<run> dir> [...]')
  const runs = dirs.map((d) => resolve(d))
  for (const d of runs) if (!existsSync(join(d, 'results.jsonl'))) fail(`${d} has no results.jsonl`)
  const dir = join(REPORTS, runId('replay'))
  mkdirSync(dir, { recursive: true })
  promptfoo(
    ['eval', '-c', 'promptfooconfig.replay.yaml', '-o', join(dir, 'results.json'), '-o', join(dir, 'report.html'),
      '--no-cache', '--no-progress-bar', '--no-share', '-j', '8'],
    promptfooEnv({ PF_REPLAY_RUNS: JSON.stringify(runs) }),
  )
  if (!existsSync(join(dir, 'results.json'))) fail('promptfoo wrote no results')
  writeSummary(dir, `promptfoo rule assertions on replayed live replies (${runs.map((d) => d.split(/[\\/]/).pop()).join(', ')})`, [
    'Then: npm run eval:pf:compare -- <this dir>, which scores the same replies with checks.py.',
  ])
  return 0
}

/** The CI subset: every scripted good reply passes, every bad one fails its rule checks. */
function stubCommand() {
  const dir = join(REPORTS, 'stub')
  mkdirSync(dir, { recursive: true })
  promptfoo(
    ['eval', '-c', 'promptfooconfig.stub.yaml', '-o', join(dir, 'results.json'), '--no-cache', '--no-progress-bar', '--no-share', '--no-write'],
    promptfooEnv(),
  )
  if (!existsSync(join(dir, 'results.json'))) fail('promptfoo wrote no results')
  const results = readResults(join(dir, 'results.json'))
  const wrong = []
  for (const r of results) {
    const label = r.provider?.label
    const id = r.vars?.case_id
    // promptfoo puts an assertion's failure text in `error` too; failureReason 2 is a real error.
    if (r.failureReason === 2) wrong.push(`${label} ${id}: errored (${r.error ?? r.response?.error})`)
    else if (label === 'stub-good' && !r.success) wrong.push(`${label} ${id}: failed (${r.gradingResult?.reason})`)
    else if (label === 'stub-bad' && r.success) wrong.push(`${label} ${id}: passed a reply built to fail`)
  }
  const expected = 20
  if (results.length !== expected) wrong.push(`expected ${expected} results, got ${results.length}`)
  process.stdout.write(
    wrong.length
      ? `\nStub subset: FAILED\n${wrong.map((w) => `  ${w}`).join('\n')}\n`
      : `\nStub subset: ${results.length} results; all 10 good replies passed and all 10 bad ones failed.\n`,
  )
  return wrong.length ? 1 : 0
}

function python() {
  for (const p of [join(AI_EVALS, '.venv', 'Scripts', 'python.exe'), join(AI_EVALS, '.venv', 'bin', 'python')])
    if (existsSync(p)) return p
  return process.platform === 'win32' ? 'python' : 'python3'
}

function compareCommand(positionals, opts) {
  if (!positionals[0]) fail('usage: node run.mjs compare <promptfoo run dir> [--calibration <dir>] [--yes]')
  // Python runs from ai-evals/, so paths given relative to here are made absolute.
  const args = ['-m', 'aievals.crossjudge', resolve(positionals[0])]
  if (opts.calibration) args.push('--calibration', resolve(opts.calibration))
  if (opts.yes) args.push('--yes')
  return spawnSync(python(), args, { cwd: AI_EVALS, stdio: 'inherit' }).status ?? 1
}

function contextsCommand() {
  // local-env.sh exports the local stack's URL and keys (it must be sourced).
  const script = 'source api-tests/scripts/local-env.sh >/dev/null && cd ai-evals && exec "$PY" -m aievals.contexts'
  return spawnSync('bash', ['-c', script], { cwd: REPO, stdio: 'inherit', env: { ...process.env, PY: python() } }).status ?? 1
}

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    set: { type: 'string' },
    models: { type: 'boolean' },
    repeat: { type: 'string' },
    only: { type: 'string', multiple: true },
    category: { type: 'string' },
    'max-usd': { type: 'string' },
    concurrency: { type: 'string' },
    calibration: { type: 'string' },
    yes: { type: 'boolean' },
  },
})
const [command = 'eval', ...rest] = positionals
const commands = {
  eval: () => evalCommand(opts),
  calibration: () => calibrationCommand(opts),
  stub: () => stubCommand(),
  replay: () => replayCommand(rest),
  compare: () => compareCommand(rest, opts),
  contexts: () => contextsCommand(),
  view: () => promptfoo(['view', '--yes'], promptfooEnv()),
}
if (!commands[command]) fail(`unknown command ${command}: ${Object.keys(commands).join(', ')}`)
for (const model of Object.values(MODELS)) if (!PRICES[model]) fail(`no price for ${model}`)
process.exit(commands[command]())
