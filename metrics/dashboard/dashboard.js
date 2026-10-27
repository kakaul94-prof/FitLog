// FitLog quality dashboard. Reads data/history.json (one record per CI run,
// appended by metrics/publish.sh) and renders everything in the browser: no
// build step, no server.
//
// Each run carries `sources: { e2e: {...}, api: {...}, unit: {...} }`. Sources of kind
// "tests" share one shape and feed every panel here, so another test suite
// shows up with no dashboard change. A new kind (e.g. "a11y" from axe, "load"
// from k6) is ignored until it gets panels of its own, so it can't break the page.
//
// The AI trainer evals' live tier is manual and has its own record shape, so it
// lives in data/ai-evals.json (appended by .github/workflows/ai-evals-live.yml)
// and gets its own section at the bottom, hidden until the first live run. The
// production canary (.github/workflows/prod-canary.yml) likewise has its own
// records in data/prod-canary.json and its own section, hidden until its first run.

const LABELS = { e2e: 'E2E', api: 'API', ai: 'AI evals', unit: 'Unit' }
const ORDER = ['e2e', 'api', 'ai', 'unit'] // top of the test pyramid first
const SLOTS = ['--s1', '--s2', '--s3', '--s4', '--s5']
const RECENT = 20

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const label = (key) => LABELS[key] ?? key
const pct = (v) => (v == null ? '—' : `${v < 10 && v > 0 ? v.toFixed(1) : Math.round(v)}%`)
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function dur(ms) {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = ms / 1000
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}
function ago(iso) {
  const m = (Date.now() - new Date(iso)) / 60000
  if (m < 60) return `${Math.max(1, Math.round(m))} min ago`
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`
  return `${Math.round(m / 1440)} days ago`
}
const when = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const testSources = (run) => Object.entries(run.sources ?? {}).filter(([, s]) => s.kind === 'tests')
const executed = (t) => t.passed + t.failed + t.flaky
const passRate = (s) => (executed(s.totals) ? ((s.totals.passed + s.totals.flaky) / executed(s.totals)) * 100 : null)
const flakyRate = (s) => (executed(s.totals) ? (s.totals.flaky / executed(s.totals)) * 100 : null)
const testId = (key, t) => `${key}|${t.project ?? ''}|${t.file}|${t.name}`

// Mirrors runStatus() in metrics/lib.mjs: a failed job (e.g. the E2E stack never
// started) fails the run even when no individual test failed.
function runStatus(run) {
  const sources = testSources(run).map(([, s]) => s)
  if (sources.some((s) => s.totals.failed > 0)) return 'failed'
  if (Object.values(run.jobs ?? {}).some((r) => r !== 'success')) return 'failed'
  if (sources.some((s) => s.totals.flaky > 0)) return 'flaky'
  return 'passed'
}
const STATUS = { passed: ['✓', 'Passed'], flaky: ['!', 'Passed with flaky tests'], failed: ['✕', 'Failed'] }
const badge = (st) => `<span class="badge ${st}"><span class="dot" aria-hidden="true">${STATUS[st][0]}</span>${STATUS[st][1]}</span>`

// Source keys in a fixed order. Colors come from the full history, not the
// filtered view, so a suite keeps its color whatever the branch filter shows.
function sourceKeys(runs) {
  const seen = new Set(runs.flatMap((r) => testSources(r).map(([k]) => k)))
  const rank = (k) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length)
  return [...seen].sort((a, b) => rank(a) - rank(b))
}
let allRuns = []
let colorKeys = []
const color = (key) => css(SLOTS[colorKeys.indexOf(key) % SLOTS.length])
const swatch = (key) => `<span class="swatch" style="background:${color(key)}"></span>`

let branch = new URLSearchParams(location.hash.slice(1)).get('branch') ?? 'all'
const charts = []

async function main() {
  try {
    const res = await fetch('data/history.json', { cache: 'no-store' })
    allRuns = (await res.json()).runs ?? []
  } catch {
    allRuns = []
  }
  try {
    const res = await fetch('data/ai-evals.json', { cache: 'no-store' })
    aiRuns = res.ok ? await res.json() : []
  } catch {
    aiRuns = []
  }
  try {
    const res = await fetch('data/perf.json', { cache: 'no-store' })
    perfRuns = res.ok ? ((await res.json()).runs ?? []) : []
  } catch {
    perfRuns = []
  }
  try {
    const res = await fetch('data/prod-canary.json', { cache: 'no-store' })
    canaryRuns = res.ok ? await res.json() : []
  } catch {
    canaryRuns = []
  }
  if (canaryRuns.length) openAlerts = await loadOpenAlerts(canaryRuns)
  try {
    const res = await fetch('data/app-canary.json', { cache: 'no-store' })
    appCanaryRuns = res.ok ? await res.json() : []
  } catch {
    appCanaryRuns = []
  }
  if (appCanaryRuns.length) appCanaryOpenAlerts = await loadOpenIssues(canaryRepo(appCanaryRuns), APP_CANARY_LABEL)
  colorKeys = sourceKeys(allRuns)
  if (window.Chart) Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif'
  render()
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render)
}

function render() {
  charts.splice(0).forEach((c) => c.destroy())
  renderFilter()
  const runs = branch === 'all' ? allRuns : allRuns.filter((r) => r.branch === branch)
  const app = document.getElementById('app')
  if (!runs.length) {
    app.innerHTML = '<p class="empty">No runs yet. The next push to main or dev publishes here.</p>' + perfSection(perfRuns) + aiSection(aiRuns) + appCanarySection(appCanaryRuns) + canarySection(canaryRuns)
    if (window.Chart) {
      if (perfRuns.length) drawPerfChart(perfRuns)
      if (aiRuns.length) {
        drawAiChart(aiRuns)
        drawAiLatency(aiRuns)
      }
      if (appCanaryRuns.length) drawAppCanaryCharts(appCanaryRuns)
      if (canaryRuns.length) drawCanaryCharts(canaryRuns)
    }
    return
  }
  const keys = sourceKeys(runs)
  app.innerHTML = [lastRun(runs.at(-1)), kpis(runs, keys), chartCards(runs, keys), tables(runs), recentRuns(runs, keys), perfSection(perfRuns), aiSection(aiRuns), appCanarySection(appCanaryRuns), canarySection(canaryRuns)].join('')
  if (window.Chart) {
    drawCharts(runs, keys)
    if (perfRuns.length) drawPerfChart(perfRuns)
    if (aiRuns.length) {
      drawAiChart(aiRuns)
      drawAiLatency(aiRuns)
    }
    if (appCanaryRuns.length) drawAppCanaryCharts(appCanaryRuns)
    if (canaryRuns.length) drawCanaryCharts(canaryRuns)
  }
}

function renderFilter() {
  const branches = [...new Set(allRuns.map((r) => r.branch))].sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b)))
  const el = document.getElementById('branch-filter')
  el.innerHTML = ['all', ...branches]
    .map((b) => `<button type="button" data-branch="${esc(b)}" aria-pressed="${b === branch}">${b === 'all' ? 'All' : esc(b)}</button>`)
    .join('')
  el.onclick = (e) => {
    const b = e.target.closest('button')?.dataset.branch
    if (!b) return
    branch = b
    location.hash = `branch=${b}`
    render()
  }
}

function lastRun(run) {
  const tests = testSources(run).reduce((n, [, s]) => n + (s.testCount ?? s.tests.length), 0)
  const jobs = Object.entries(run.jobs ?? {})
    .map(([job, r]) => `${esc(job)} ${r === 'success' ? '✓' : `✕ ${esc(r)}`}`)
    .join(' · ')
  return `<section class="card last" style="margin-bottom:12px" aria-label="Last run">
    ${badge(runStatus(run))}
    <span class="meta">Last run · <strong>${esc(run.branch)}</strong> @
      <a href="https://github.com/${esc(run.repo)}/commit/${esc(run.sha)}"><code>${esc(run.sha.slice(0, 7))}</code></a> · ${ago(run.timestamp)}</span>
    <span class="meta">${tests} tests${jobs ? ` · jobs: ${jobs}` : ''}</span>
    ${run.runUrl ? `<a href="${esc(run.runUrl)}">View CI run ↗</a>` : ''}
  </section>`
}

function kpis(runs, keys) {
  const recent = runs.slice(-RECENT)
  const green = recent.filter((r) => runStatus(r) !== 'failed').length
  const retried = recent.flatMap((r) => testSources(r).filter(([, s]) => s.retries > 0).map(([, s]) => s.totals))
  const flaky = retried.reduce((n, t) => n + t.flaky, 0)
  const ran = retried.reduce((n, t) => n + executed(t), 0)
  const tile = (lbl, value, ctx) => `<div class="card kpi"><div class="label">${lbl}</div><div class="value">${value}</div><div class="ctx">${ctx}</div></div>`
  const durations = keys.map((k) => {
    const ds = runs.slice(-10).map((r) => r.sources[k]?.durationMs).filter((v) => v != null)
    return tile(`${label(k)} suite time`, dur(runs.at(-1).sources[k]?.durationMs), `latest · median of last ${ds.length}: ${dur(median(ds))}`)
  })
  const waits = runs.slice(-10).map((r) => r.feedbackMs).filter((v) => v != null)
  const feedback = waits.length
    ? tile('Feedback time', dur(waits.at(-1)), `push → all results · median of last ${waits.length}: ${dur(median(waits))}`)
    : ''
  return `<section class="grid kpis" aria-label="Summary">
    ${tile('Runs passing', `${green}/${recent.length}`, `last ${recent.length} runs, flaky still passes`)}
    ${tile('Flaky rate', ran ? pct((flaky / ran) * 100) : '—', `${flaky} flaky of ${ran} retry-enabled test results`)}
    ${feedback}
    ${durations.join('')}
  </section>`
}

function chartCards(runs, keys) {
  const card = (id, title, note) => `<div class="card"><h2>${title}</h2><p class="note">${note}</p><div class="chart"><canvas id="${id}" role="img" aria-label="${title} chart"></canvas></div></div>`
  return `<section class="grid two">
      ${card('c-pass', 'Pass rate', 'Tests that passed (incl. after a retry) ÷ tests run, per CI run')}
      ${card('c-flaky', 'Flaky rate', 'Tests that needed a retry to pass ÷ tests run (suites with retries)')}
    </section>
    ${runs.some((r) => r.feedbackMs != null) ? `<section class="grid two">${card('c-feedback', 'Feedback time', 'From the push to every test result being in')}</section>` : ''}
    <section class="grid multiples" aria-label="Suite duration">
      ${keys.map((k) => card(`c-dur-${k}`, `${label(k)} suite duration`, 'Wall-clock time per run')).join('')}
    </section>`
}

function drawCharts(runs, keys) {
  const labels = runs.map((r) => new Date(r.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
  const series = (k, fn) => ({ label: label(k), data: runs.map((r) => (r.sources[k] ? fn(r.sources[k]) : null)), color: color(k) })
  line('c-pass', runs, labels, keys.map((k) => series(k, passRate)), { max: 100, suggestedMin: 90, fmt: (v) => `${Math.round(v * 10) / 10}%` })
  const retried = keys.filter((k) => runs.some((r) => r.sources[k]?.retries > 0))
  line('c-flaky', runs, labels, retried.map((k) => series(k, flakyRate)), { beginAtZero: true, suggestedMax: 10, fmt: (v) => `${Math.round(v * 10) / 10}%` })
  if (document.getElementById('c-feedback')) {
    const waits = { label: 'Push → results', data: runs.map((r) => (r.feedbackMs == null ? null : r.feedbackMs / 1000)), color: css(SLOTS[3]) }
    line('c-feedback', runs, labels, [waits], { beginAtZero: true, fmt: (v) => dur(v * 1000) })
  }
  for (const k of keys) {
    line(`c-dur-${k}`, runs, labels, [series(k, (s) => s.durationMs / 1000)], { beginAtZero: true, fmt: (v) => dur(v * 1000) })
  }
}

function line(id, runs, labels, datasets, { fmt, max, suggestedMin, suggestedMax, beginAtZero = false }) {
  const muted = css('--muted')
  const dense = labels.length > 40
  charts.push(
    new Chart(document.getElementById(id), {
      type: 'line',
      data: {
        labels,
        datasets: datasets.map((d) => ({
          ...d,
          borderColor: d.color,
          backgroundColor: d.color,
          borderWidth: 2,
          pointRadius: dense ? 0 : 3,
          pointHoverRadius: 5,
          pointBorderColor: css('--surface'),
          spanGaps: true,
        })),
      },
      options: {
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          // One series: the card title names it. Two or more: a legend.
          legend: { display: datasets.length > 1, align: 'start', labels: { color: css('--ink-2'), usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
          tooltip: {
            callbacks: {
              title: ([item]) => {
                const r = runs[item.dataIndex]
                return `${when(r.timestamp)} · ${r.sha.slice(0, 7)} (${r.branch})`
              },
              label: (item) => ` ${item.dataset.label}: ${fmt(item.parsed.y)}`,
              footer: () => 'Click to open the CI run',
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: css('--axis') }, ticks: { color: muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
          y: { max, suggestedMin, suggestedMax, beginAtZero, grid: { color: css('--grid') }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 5, callback: fmt } },
        },
        onClick: (_, els) => {
          const r = runs[els[0]?.index]
          if (r?.runUrl) window.open(r.runUrl, '_blank', 'noopener')
        },
      },
    }),
  )
}

const testCell = (t) => `<td class="test">${esc(t.name)}<small>${esc(t.file)}${t.project ? ` · ${esc(t.project)}` : ''}</small></td>`

function tables(runs) {
  // Top flaky: how often each test needed a retry across the selected runs.
  const byTest = new Map()
  for (const run of runs) {
    for (const [key, s] of testSources(run)) {
      for (const t of s.tests) {
        const g = byTest.get(testId(key, t)) ?? { key, t, seen: 0, flaky: 0, last: null }
        g.seen++
        if (t.status === 'flaky') Object.assign(g, { flaky: g.flaky + 1, last: run })
        byTest.set(testId(key, t), g)
      }
    }
  }
  const flaky = [...byTest.values()].filter((g) => g.flaky).sort((a, b) => b.flaky - a.flaky || b.last.timestamp.localeCompare(a.last.timestamp)).slice(0, 10)
  const flakyRows = flaky
    .map((g) => `<tr>${testCell(g.t)}<td>${swatch(g.key)}${label(g.key)}</td><td class="num">${g.flaky} / ${g.seen}</td><td class="num">${pct((g.flaky / g.seen) * 100)}</td>
      <td class="num"><a href="${esc(g.last.runUrl ?? '#')}">${when(g.last.timestamp)}</a></td></tr>`)
    .join('')

  // Slowest 10 in the latest run, against the same test's average over the last 10 runs.
  const latest = runs.at(-1)
  const window10 = runs.slice(-10)
  const slow = testSources(latest)
    .flatMap(([key, s]) => s.tests.filter((t) => t.status !== 'skipped').map((t) => ({ key, t })))
    .sort((a, b) => b.t.durationMs - a.t.durationMs)
    .slice(0, 10)
  const slowRows = slow
    .map(({ key, t }) => {
      const id = testId(key, t)
      const past = window10.flatMap((r) => (r.sources[key]?.tests ?? []).filter((x) => testId(key, x) === id).map((x) => x.durationMs))
      const avg = past.reduce((a, b) => a + b, 0) / past.length
      return `<tr>${testCell(t)}<td>${swatch(key)}${label(key)}</td><td class="num">${dur(t.durationMs)}</td><td class="num">${dur(avg)} <small>(${past.length})</small></td></tr>`
    })
    .join('')

  return `<section class="grid two">
    <div class="card"><h2>Top flaky tests</h2><p class="note">Failed, then passed on retry · across ${runs.length} runs</p>
      ${flaky.length
        ? `<div class="table-wrap"><table><thead><tr><th>Test</th><th>Suite</th><th class="num">Flaky runs</th><th class="num">Rate</th><th class="num">Last flaky</th></tr></thead><tbody>${flakyRows}</tbody></table></div>`
        : `<p class="empty">No flaky tests in these ${runs.length} runs.</p>`}
    </div>
    <div class="card"><h2>Slowest 10 tests</h2><p class="note">Latest run, with each test's average over the last ${window10.length} runs</p>
      <div class="table-wrap"><table><thead><tr><th>Test</th><th>Suite</th><th class="num">Latest</th><th class="num">Avg (runs)</th></tr></thead><tbody>${slowRows}</tbody></table></div>
    </div>
  </section>`
}

// The run-by-run table doubles as the accessible, non-visual view of the charts.
function recentRuns(runs, keys) {
  const rows = runs.slice(-15).reverse().map((r) => {
    const cells = keys.map((k) => {
      const s = r.sources[k]
      if (!s) return '<td class="num">—</td><td class="num">—</td>'
      const t = s.totals
      const extra = [t.flaky && `${t.flaky} flaky`, t.failed && `${t.failed} failed`].filter(Boolean).join(', ')
      return `<td class="num">${t.passed + t.flaky}/${executed(t)}${extra ? ` <small>(${extra})</small>` : ''}</td><td class="num">${dur(s.durationMs)}</td>`
    })
    return `<tr><td>${when(r.timestamp)}</td><td>${esc(r.branch)}</td>
      <td><a href="https://github.com/${esc(r.repo)}/commit/${esc(r.sha)}"><code>${esc(r.sha.slice(0, 7))}</code></a></td>
      <td>${badge(runStatus(r))}</td>${cells.join('')}<td>${r.runUrl ? `<a href="${esc(r.runUrl)}">Run ↗</a>` : ''}</td></tr>`
  })
  const heads = keys.map((k) => `<th class="num">${label(k)} passed</th><th class="num">${label(k)} time</th>`).join('')
  return `<section class="card"><h2>Recent runs</h2><p class="note">Newest first · last ${rows.length} of ${runs.length}</p>
    <div class="table-wrap"><table><thead><tr><th>When</th><th>Branch</th><th>Commit</th><th>Result</th>${heads}<th></th></tr></thead>
    <tbody>${rows.join('')}</tbody></table></div></section>`
}

// -- AI trainer evals, live tier ------------------------------------------------------

const AI_LABELS = {
  prompt_injection: 'Prompt injection',
  information_exposure: 'Information exposure',
  unintended_actions: 'Unintended actions',
  output_quality: 'Output quality',
  fairness: 'Fairness',
}
let aiRuns = []

function aiSection(runs) {
  if (!runs.length) return ''
  const last = runs.at(-1)
  const tile = (lbl, value, ctx) => `<div class="card kpi"><div class="label">${lbl}</div><div class="value">${value}</div><div class="ctx">${ctx}</div></div>`
  const rate = (m) => (m?.rate == null ? '—' : `${pct(m.rate * 100)} <small>bar ${Math.round(m.bar * 100)}%</small>`)
  const other = (c) =>
    Object.entries(c.metrics)
      .filter(([name]) => name !== 'rules' && name !== 'judged')
      .map(([name, m]) => `${esc(name.replace('_', ' '))} ${rate(m)}`)
      .join('<br>') || '—'
  const rows = Object.entries(last.categories)
    .map(([cat, c]) => `<tr><td>${esc(AI_LABELS[cat] ?? cat)}</td><td class="num">${rate(c.metrics.rules)}</td>
      <td class="num">${rate(c.metrics.judged)}</td><td class="num">${other(c)}</td><td>${c.met ? 'met' : '<strong>not met</strong>'}</td></tr>`)
    .join('')
  const groups = (last.fairness_groups ?? [])
    .map((g) => `<tr><td><code>${esc(g.group)}</code></td><td>${g.status === 'equivalent' ? 'equivalent' : g.status === 'unscored' ? 'unscored' : '<strong>different</strong>'}</td>
      <td class="num">${g.parity_gap == null ? '—' : pct(g.parity_gap * 100)}</td>
      <td>${Object.entries(g.differences ?? {}).map(([v, d]) => `<code>${esc(v)}</code>: ${esc(d.join('; '))}`).join('<br>') || '—'}</td></tr>`)
    .join('')
  const flagged = [...last.failing.map((id) => `<code>${esc(id)}</code> failed every run`), ...last.inconsistent.map((id) => `<code>${esc(id)}</code> inconsistent`)]
  return `<h2 class="section-title">AI trainer evals · live tier</h2>
    <section class="grid kpis" aria-label="AI evals summary">
      ${tile('Last live run', esc(last.gate), `${when(last.timestamp)} · ${esc(last.model)} · ${last.cases} cases × ${last.reps} runs`)}
      ${tile('Cost', `$${last.cost.total_usd.toFixed(2)}`, `trainer $${last.cost.trainer_usd.toFixed(2)} · judge $${last.cost.judge_usd.toFixed(2)}`)}
      ${tile('Latency p95', last.latency ? dur(last.latency.p95_ms) : '—', last.latency ? `question → whole answer · p50 ${dur(last.latency.p50_ms)} · max ${dur(last.latency.max_ms)}` : 'not recorded by this run')}
      ${tile('Live runs', runs.length, `judge ${esc(last.judge_model)} · ${last.inconsistent.length} inconsistent in the last run`)}
    </section>
    <section class="grid two">
      <div class="card"><h2>Pass rate by category</h2><p class="note">Runs whose rule checks all passed, per live run</p>
        <div class="chart"><canvas id="c-ai" role="img" aria-label="AI eval pass rate by category chart"></canvas></div></div>
      <div class="card"><h2>Latest run</h2><p class="note">Against each category's bar (see ai-evals/README.md)</p>
        <div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">Rule checks</th><th class="num">Judged</th><th class="num">Other</th><th>Gate</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        ${flagged.length ? `<p class="note">${flagged.join(' · ')}</p>` : ''}</div>
    </section>
    ${runs.some((r) => r.latency) ? `<section class="grid two">
      <div class="card"><h2>Latency</h2><p class="note">p50 and p95 of question → whole answer, per live run. Informative here: answers go through a local proxy</p>
        <div class="chart"><canvas id="c-ai-latency" role="img" aria-label="AI eval latency chart"></canvas></div></div>
      <div class="card"><h2>Latency by category</h2><p class="note">Latest live run · ${budgetSummary(last.latency) || 'not recorded by this run'}</p>
        ${last.latency?.categories ? latencyTable(last.latency) : ''}</div>
    </section>` : ''}
    ${groups ? `<section class="card"><h2>Fairness groups</h2><p class="note">Latest live run · each group asks the same thing of the same log, varying one attribute. Parity gap: largest difference in rule pass rate from the baseline (one run in three is allowed)</p>
      <div class="table-wrap"><table><thead><tr><th>Group</th><th>Result</th><th class="num">Parity gap</th><th>Target differences</th></tr></thead><tbody>${groups}</tbody></table></div></section>` : ''}`
}

function drawAiLatency(runs) {
  const timed = runs.filter((r) => r.latency)
  if (!timed.length || !document.getElementById('c-ai-latency')) return
  const labels = timed.map((r) => new Date(r.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
  const ds = (label, key, slot) => ({ label, data: timed.map((r) => r.latency[key] / 1000), borderColor: css(slot), backgroundColor: css(slot), borderWidth: 2, pointRadius: 3, spanGaps: true })
  charts.push(
    new Chart(document.getElementById('c-ai-latency'), {
      type: 'line',
      data: { labels, datasets: [ds('p95', 'p95_ms', '--s2'), ds('p50', 'p50_ms', '--s1')] },
      options: {
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { align: 'start', labels: { color: css('--ink-2'), usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
          tooltip: { callbacks: { label: (item) => ` ${item.dataset.label}: ${dur(item.parsed.y * 1000)}` } },
        },
        scales: {
          x: { grid: { display: false }, border: { color: css('--axis') }, ticks: { color: css('--muted'), maxRotation: 0 } },
          y: { beginAtZero: true, grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--muted'), callback: (v) => dur(v * 1000) } },
        },
      },
    }),
  )
}

function drawAiChart(runs) {
  const labels = runs.map((r) => new Date(r.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
  const datasets = Object.keys(AI_LABELS).map((cat, i) => ({
    label: AI_LABELS[cat],
    data: runs.map((r) => (r.categories[cat]?.metrics.rules?.rate == null ? null : r.categories[cat].metrics.rules.rate * 100)),
    borderColor: css(SLOTS[i]),
    backgroundColor: css(SLOTS[i]),
    borderWidth: 2,
    pointRadius: 3,
    spanGaps: true,
  }))
  charts.push(
    new Chart(document.getElementById('c-ai'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { align: 'start', labels: { color: css('--ink-2'), usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
          tooltip: { callbacks: { label: (item) => ` ${item.dataset.label}: ${Math.round(item.parsed.y)}%` } },
        },
        scales: {
          x: { grid: { display: false }, border: { color: css('--axis') }, ticks: { color: css('--muted'), maxRotation: 0 } },
          y: { min: 0, max: 100, grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--muted'), callback: (v) => `${v}%` } },
        },
      },
    }),
  )
}

// Per-category p95 against its budget, for the latest run of either tier.
function latencyRows(lat) {
  return Object.entries(lat?.categories ?? {})
    .map(([cat, m]) => `<tr><td>${esc(AI_LABELS[cat] ?? cat)}</td><td class="num">${dur(m.p50_ms)}</td><td class="num">${dur(m.p95_ms)}</td>
      <td class="num">${m.budget_p95_ms ? dur(m.budget_p95_ms) : '—'}</td><td>${m.ok ? 'within' : '<strong>over</strong>'}</td><td class="num">${m.samples}</td></tr>`)
    .join('')
}
const latencyTable = (lat) =>
  `<div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">p50</th><th class="num">p95</th><th class="num">p95 budget</th><th>Budget</th><th class="num">Answers</th></tr></thead><tbody>${latencyRows(lat)}</tbody></table></div>`
const budgetSummary = (lat) => {
  const cats = Object.values(lat?.categories ?? {})
  if (!cats.length) return ''
  const over = lat.over_budget ?? []
  return over.length ? `p95 over budget in ${over.map((c) => esc(AI_LABELS[c] ?? c)).join(', ')}` : `all ${cats.length} categories within their p95 budget`
}

// -- Production canary -----------------------------------------------------------------

// data/prod-canary.json: one record per scheduled run of the production canary
// (.github/workflows/prod-canary.yml), appended by ai-evals/scripts/publish-canary.sh.
// Drills (runs broken on purpose to prove the alerting) are listed but kept out
// of the trend lines. The open-alert tile reads GitHub live, so it is the truth
// now, not the state at the last run; the last record is the fallback.
let canaryRuns = []
let openAlerts = null // null: GitHub could not be read

const CANARY_LABEL = 'prod-ai-alert'
const canaryRepo = (runs) => runs.map((r) => r.run_url?.match(/github\.com\/([^/]+\/[^/]+)\/actions/)?.[1]).find(Boolean)

async function loadOpenAlerts(runs) {
  const repo = canaryRepo(runs)
  if (!repo) return null
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues?labels=${CANARY_LABEL}&state=open&per_page=10`, {
      headers: { accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    return (await res.json()).filter((i) => !i.pull_request)
  } catch {
    return null
  }
}

const canaryAnswered = (r) => (r.attempts ? ((r.attempts - r.infrastructure.errors.length) / r.attempts) * 100 : null)
const canaryPassRate = (r) => (r.scored ? (r.quality.passed / r.scored) * 100 : null)
// Which kinds the run's own alert step opened or kept open.
const alertKinds = (r) => Object.entries(r.alerts ?? {}).filter(([k, a]) => k !== 'issues' && (a === 'opened' || a === 'commented')).map(([k]) => k)

function canaryResult(r) {
  if (r.status === 'pass') return badge('passed')
  const why = [!r.infrastructure.ok && 'endpoint', r.quality.ok === false && 'quality'].filter(Boolean).join(' + ')
  return `${badge('failed')} <small>${esc(why)}</small>`
}

function openAlertTile(tile, last) {
  if (openAlerts === null) {
    const kinds = alertKinds(last)
    return tile('Open alert', kinds.length ? esc(kinds.join(' + ')) : 'none', `as of the last run (GitHub not readable) · label ${CANARY_LABEL}`)
  }
  if (!openAlerts.length) return tile('Open alert', 'none', `no open issue labelled ${CANARY_LABEL}`)
  const links = openAlerts.map((i) => `<a href="${esc(i.html_url)}">#${i.number}</a> ${ago(i.created_at)}`).join(' · ')
  const kinds = openAlerts.map((i) => i.body?.match(/prod-ai-alert kind=(\w+)/)?.[1] ?? 'alert')
  return tile('Open alert', esc([...new Set(kinds)].join(' + ')), links)
}

function canarySection(runs) {
  if (!runs.length) return ''
  const tile = (lbl, value, ctx) => `<div class="card kpi"><div class="label">${lbl}</div><div class="value">${value}</div><div class="ctx">${ctx}</div></div>`
  const last = runs.at(-1)
  const real = runs.filter((r) => !r.drill)
  const recent = real.slice(-RECENT)
  const lat = last.latency
  const rows = runs.slice(-15).reverse().map((r) => {
    const kinds = alertKinds(r)
    const issues = r.alerts?.issues ?? {}
    const alertCell = kinds.length
      ? kinds.map((k) => `${esc(k)}${issues[k] ? ` <a href="https://github.com/${esc(canaryRepo(runs) ?? '')}/issues/${issues[k]}">#${issues[k]}</a>` : ''}`).join(', ')
      : Object.values(r.alerts ?? {}).includes('closed') ? 'closed' : '—'
    return `<tr><td>${when(r.timestamp)}</td><td>${r.drill ? `<small>drill: ${esc(r.drill)}</small>` : canaryResult(r)}</td>
      <td class="num">${r.scored ? `${r.quality.passed}/${r.scored}` : '—'}</td>
      <td class="num">${r.attempts - r.infrastructure.errors.length}/${r.attempts}</td>
      <td class="num">${dur(r.latency?.p50_ms)}</td><td class="num">${dur(r.latency?.p95_ms)}</td>
      <td class="num">$${r.cost.total_usd.toFixed(3)}</td><td>${alertCell}</td>
      <td>${r.run_url ? `<a href="${esc(r.run_url)}">Run ↗</a>` : ''}</td></tr>`
  })
  return `<h2 class="section-title">Production canary</h2>
    <p class="note">Twice a day, ${last.cases} eval cases through the real production trainer as a monitor account (<code>ai-evals/aievals/canary.py</code>). A failing run opens a GitHub issue labelled <code>${CANARY_LABEL}</code>; the first run that recovers closes it. Outside the release gate. Cost is estimated from characters: production returns no token counts.</p>
    <section class="grid kpis" aria-label="Production canary summary">
      ${tile('Last canary run', last.drill ? `<small>drill: ${esc(last.drill)}</small>` : canaryResult(last), `${ago(last.timestamp)} · ${esc(last.site)}${last.snapshot?.stale ? ' · snapshot fixture is stale' : ''}`)}
      ${tile('Runs passing', `${recent.filter((r) => r.status === 'pass').length}/${recent.length}`, `last ${recent.length} real runs${runs.length - real.length ? ` · ${runs.length - real.length} drills not counted` : ''}`)}
      ${tile('Latency p50 / p95', lat ? `${dur(lat.p50_ms)} / ${dur(lat.p95_ms)}` : '—', lat ? `question → whole answer · first byte p50 ${dur(lat.first_byte_p50_ms)} · ${budgetSummary(lat)}` : 'no answers to time in the last run')}
      ${openAlertTile(tile, last)}
    </section>
    <section class="grid two">
      <div class="card"><h2>Pass rate</h2><p class="note">Cases passed ÷ cases scored, and calls answered ÷ calls made, per run (drills left out)</p>
        <div class="chart"><canvas id="c-canary-pass" role="img" aria-label="Production canary pass rate chart"></canvas></div></div>
      <div class="card"><h2>Latency</h2><p class="note">p50 and p95 of question → whole answer, and p50 to the first byte, per run</p>
        <div class="chart"><canvas id="c-canary-latency" role="img" aria-label="Production canary latency chart"></canvas></div></div>
    </section>
    ${lat?.categories ? `<section class="card"><h2>Latency by category</h2><p class="note">Latest canary run · each category's p95 has its own budget; one over budget opens an infrastructure alert</p>${latencyTable(lat)}</section>` : ''}
    <section class="card"><h2>Recent canary runs</h2><p class="note">Newest first · last ${rows.length} of ${runs.length} · cost per run is an estimate</p>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Result</th><th class="num">Cases</th><th class="num">Answered</th><th class="num">p50</th><th class="num">p95</th><th class="num">Cost</th><th>Alert</th><th></th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div></section>`
}

function drawCanaryCharts(runs) {
  const real = runs.filter((r) => !r.drill)
  if (!real.length) return
  const labels = real.map((r) => new Date(r.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' }))
  const series = (label, data, slot, extra = {}) => ({ label, data, borderColor: css(slot), backgroundColor: css(slot), borderWidth: 2, pointRadius: real.length > 40 ? 0 : 3, spanGaps: true, ...extra })
  const options = (fmt, scale) => ({
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { align: 'start', labels: { color: css('--ink-2'), usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
      tooltip: {
        callbacks: {
          title: ([item]) => `${when(real[item.dataIndex].timestamp)} · ${real[item.dataIndex].run_id}`,
          label: (item) => ` ${item.dataset.label}: ${fmt(item.parsed.y)}`,
          footer: () => 'Click to open the workflow run',
        },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: css('--axis') }, ticks: { color: css('--muted'), maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
      y: { ...scale, grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--muted'), maxTicksLimit: 5, callback: fmt } },
    },
    onClick: (_, els) => {
      const r = real[els[0]?.index]
      if (r?.run_url) window.open(r.run_url, '_blank', 'noopener')
    },
  })
  charts.push(
    new Chart(document.getElementById('c-canary-pass'), {
      type: 'line',
      data: { labels, datasets: [series('Cases passed', real.map(canaryPassRate), '--s3'), series('Calls answered', real.map(canaryAnswered), '--s1')] },
      options: options((v) => `${Math.round(v)}%`, { min: 0, max: 100 }),
    }),
  )
  charts.push(
    new Chart(document.getElementById('c-canary-latency'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          series('p95', real.map((r) => (r.latency ? r.latency.p95_ms / 1000 : null)), '--s2'),
          series('p50', real.map((r) => (r.latency ? r.latency.p50_ms / 1000 : null)), '--s1'),
          series('first byte p50', real.map((r) => (r.latency?.first_byte_p50_ms != null ? r.latency.first_byte_p50_ms / 1000 : null)), '--s3', { borderDash: [4, 4] }),
        ],
      },
      options: options((v) => dur(v * 1000), { beginAtZero: true }),
    }),
  )
}

// --- Performance (k6, perf-tests/) ------------------------------------------------
// data/perf.json: one record per nightly or manual perf run (appended by
// metrics/publish-perf.sh), each carrying the scenarios it ran: load, soak,
// stress, spike. Numbers are from journey requests only; budgets are in
// perf-tests/config/thresholds.ts.
let perfRuns = []
const PERF_ORDER = ['load', 'soak', 'stress', 'spike', 'smoke']
const perfScenarios = (runs) =>
  [...new Set(runs.flatMap((r) => Object.keys(r.scenarios ?? {})))].sort((a, b) => PERF_ORDER.indexOf(a) - PERF_ORDER.indexOf(b))
const ms = (v) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`)
const ratePct = (v) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`)
const perfVerdict = (s) =>
  s.passed
    ? s.reasons.length
      ? '<span class="badge flaky"><span class="dot" aria-hidden="true">!</span>Report-only</span>'
      : badge('passed')
    : badge('failed')

function perfSection(runs) {
  if (!runs.length) return ''
  const last = runs.at(-1)
  const names = perfScenarios([last])
  const primary = last.scenarios[names.includes('load') ? 'load' : names[0]]
  const tile = (lbl, value, ctx) => `<div class="card kpi"><div class="label">${lbl}</div><div class="value">${value}</div><div class="ctx">${ctx}</div></div>`
  const held = primary.thresholds.total - primary.thresholds.failed.length
  const rows = names
    .flatMap((name) =>
      Object.entries(last.scenarios[name].groups).map(
        ([op, g]) => `<tr><td>${esc(name)}</td><td>${esc(op)}</td><td class="num">${ms(g.p95)}</td><td class="num">${ms(g.p99)}</td>
          <td class="num">${g.budget ? `${g.budget.p95} / ${g.budget.p99} ms` : '—'}</td><td class="num">${ratePct(g.errorRate)}</td><td class="num">${g.count}</td></tr>`,
      ),
    )
    .join('')
  const notes = names.flatMap((name) => last.scenarios[name].reasons.map((r) => `<strong>${esc(name)}:</strong> ${esc(r)}`))
  const drift = names.map((name) => last.scenarios[name].phases).find((p) => p?.drift != null)
  return `<h2 class="section-title">Performance · k6</h2>
    <section class="grid kpis" aria-label="Performance summary">
      ${tile('Last run', names.map((n) => `${esc(n)} ${perfVerdict(last.scenarios[n])}`).join('<br>'), `${when(last.timestamp)} · ${last.sha.slice(0, 7)} (${esc(last.branch)})`)}
      ${tile(`p95 latency · ${esc(primary.scenario)}`, ms(primary.latency?.p95), `p99 ${ms(primary.latency?.p99)} · ${primary.vusMax} virtual users`)}
      ${tile('Error rate', ratePct(primary.errorRate), `${primary.requests.count} requests · ${primary.requests.rps ?? '—'}/s`)}
      ${tile('Thresholds held', `${held}/${primary.thresholds.total}`, primary.thresholds.failed.length ? esc(primary.thresholds.failed[0]) : drift ? `soak drift ${drift.drift}× (limit ${drift.driftMax}×)` : 'every budget held')}
    </section>
    <section class="grid two">
      <div class="card"><h2>p95 latency by scenario</h2><p class="note">Journey requests, per published run</p>
        <div class="chart"><canvas id="c-perf" role="img" aria-label="p95 latency by scenario chart"></canvas></div></div>
      <div class="card"><h2>Latest run by endpoint group</h2><p class="note">Budgets from perf-tests/config/thresholds.ts</p>
        <div class="table-wrap"><table><thead><tr><th>Scenario</th><th>Group</th><th class="num">p95</th><th class="num">p99</th><th class="num">Budget</th><th class="num">Errors</th><th class="num">Requests</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        ${notes.length ? `<p class="note">${notes.join('<br>')}</p>` : ''}</div>
    </section>`
}

function drawPerfChart(runs) {
  const names = perfScenarios(runs)
  const labels = runs.map((r) => new Date(r.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
  const datasets = names.map((name, i) => ({
    label: name,
    color: css(SLOTS[i % SLOTS.length]),
    data: runs.map((r) => r.scenarios[name]?.latency?.p95 ?? null),
  }))
  line('c-perf', runs, labels, datasets, { fmt: ms, beginAtZero: true })
}

main()

// -- Production app canary ---------------------------------------------------------

// data/app-canary.json: one record per run of the production app canary
// (.github/workflows/app-canary.yml, canary/), appended by canary/publish.sh:
// a real user's journey (sign in, load the diary, log a food and see it saved,
// delete it, ask the trainer) through the live app every 30 minutes and after
// every deploy. Uptime is the share of real runs (drills left out) that
// passed, the flaky ones included: a retry that passed means the app was up.
// The open-alert tile reads GitHub live, like the AI canary's.
let appCanaryRuns = []
let appCanaryOpenAlerts = null // null: GitHub could not be read

const APP_CANARY_LABEL = 'prod-app-canary'
const APP_CANARY_DAY_MS = 24 * 60 * 60 * 1000

async function loadOpenIssues(repo, labelName) {
  if (!repo) return null
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues?labels=${labelName}&state=open&per_page=10`, {
      headers: { accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    return (await res.json()).filter((i) => !i.pull_request)
  } catch {
    return null
  }
}

const appUp = (r) => r.status === 'pass' || r.status === 'flaky'
const appReal = (runs) => runs.filter((r) => !r.drill)
const appSince = (runs, ms, now = Date.now()) => runs.filter((r) => now - new Date(r.timestamp) < ms)
const appUptime = (runs) => (runs.length ? (runs.filter(appUp).length / runs.length) * 100 : null)
const appQuantile = (xs, q) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}
const appStepNames = (runs) => (runs.at(-1)?.steps ?? []).map((s) => s.name)
const appStepDuration = (r, name) => r.steps?.find((s) => s.name === name && s.status === 'pass')?.duration_ms ?? null

function appCanaryResult(r) {
  if (r.drill) return `<small>drill: ${esc(r.drill)}</small>`
  if (r.status === 'pass') return badge('passed')
  if (r.status === 'flaky') return badge('flaky')
  return `${badge('failed')} <small>${esc(r.failing_step ?? 'before the first step')}</small>`
}

function appCanaryAlertTile(tile, last) {
  if (appCanaryOpenAlerts === null) {
    const open = last.alert && (last.alert.action === 'opened' || last.alert.action === 'commented')
    const link = open && last.alert.url ? `<a href="${esc(last.alert.url)}">#${last.alert.issue}</a>` : 'none'
    return tile('Open alert', link, `as of the last run (GitHub not readable) · label ${APP_CANARY_LABEL}`)
  }
  if (!appCanaryOpenAlerts.length) return tile('Open alert', 'none', `no open issue labelled ${APP_CANARY_LABEL}`)
  const links = appCanaryOpenAlerts.map((i) => `<a href="${esc(i.html_url)}">#${i.number}</a> ${ago(i.created_at)}`).join(' · ')
  return tile('Open alert', 'yes', links)
}

function appCanarySection(runs) {
  if (!runs.length) return ''
  const tile = (lbl, value, ctx) => `<div class="card kpi"><div class="label">${lbl}</div><div class="value">${value}</div><div class="ctx">${ctx}</div></div>`
  const last = runs.at(-1)
  const real = appReal(runs)
  const day = appSince(real, APP_CANARY_DAY_MS)
  const week = appSince(real, 7 * APP_CANARY_DAY_MS)
  const month = appSince(real, 30 * APP_CANARY_DAY_MS)
  const journeys = week.filter(appUp).map((r) => r.duration_ms).filter((d) => d != null)
  const steps = appStepNames(runs).map((name) => {
    const taken = week.map((r) => appStepDuration(r, name)).filter((d) => d != null)
    const failed = week.filter((r) => r.failing_step === name).length
    return `<tr><td>${esc(name)}</td><td class="num">${dur(appQuantile(taken, 0.5))}</td><td class="num">${dur(appQuantile(taken, 0.95))}</td><td class="num">${failed || '—'}</td><td class="num">${taken.length}</td></tr>`
  })
  const rows = runs.slice(-15).reverse().map((r) => {
    const alert = r.alert?.issue
      ? `${esc(r.alert.action)} <a href="${esc(r.alert.url ?? `https://github.com/${canaryRepo(runs) ?? ''}/issues/${r.alert.issue}`)}">#${r.alert.issue}</a>`
      : r.alert?.action && r.alert.action !== 'none' ? esc(r.alert.action) : '—'
    return `<tr><td>${when(r.timestamp)}</td><td>${esc(r.trigger ?? '')}</td><td>${appCanaryResult(r)}</td>
      <td class="num">${dur(r.duration_ms)}</td><td>${r.trainer ? 'asked' : '—'}</td><td>${alert}</td>
      <td>${r.run_url ? `<a href="${esc(r.run_url)}">Run ↗</a>` : ''}</td></tr>`
  })
  return `<h2 class="section-title">Production app canary</h2>
    <p class="note">Every 30 minutes and after every deploy, a phone-sized browser signs in to the live app as a monitor account, loads today's diary, logs a 1 kcal food, checks it in the database, deletes it, and (on the hour) asks the trainer (<code>canary/</code>). A failing run opens a GitHub issue labelled <code>${APP_CANARY_LABEL}</code>; the first run that recovers closes it. A missing secret fails the run instead of skipping it. Outside the release gate.</p>
    <section class="grid kpis" aria-label="Production app canary summary">
      ${tile('Last run', appCanaryResult(last), `${ago(last.timestamp)} · ${esc(last.trigger ?? '')} · ${esc((last.site ?? '').replace(/^https?:\/\//, ''))}`)}
      ${tile('Uptime 24 h / 7 d', `${pct(appUptime(day))} / ${pct(appUptime(week))}`, `${day.length} and ${week.length} real runs · 30 d ${pct(appUptime(month))} over ${month.length}${runs.length - real.length ? ` · ${runs.length - real.length} drills not counted` : ''}`)}
      ${tile('Journey p50 / p95', journeys.length ? `${dur(appQuantile(journeys, 0.5))} / ${dur(appQuantile(journeys, 0.95))}` : '—', `sign-in to the last step, passing runs of the last 7 days`)}
      ${appCanaryAlertTile(tile, last)}
    </section>
    <section class="grid two">
      <div class="card"><h2>Uptime per day</h2><p class="note">Real runs that passed ÷ real runs, per day, last 30 days</p>
        <div class="chart"><canvas id="c-app-canary-uptime" role="img" aria-label="Production app canary uptime per day chart"></canvas></div></div>
      <div class="card"><h2>Time per step</h2><p class="note">How long each step took, per passing run (stacked), last 60 real runs</p>
        <div class="chart"><canvas id="c-app-canary-steps" role="img" aria-label="Production app canary step duration chart"></canvas></div></div>
    </section>
    <section class="card"><h2>Steps, last 7 days</h2><p class="note">p50 and p95 of each step across passing runs, and how many runs failed at it</p>
      <div class="table-wrap"><table><thead><tr><th>Step</th><th class="num">p50</th><th class="num">p95</th><th class="num">Failed at</th><th class="num">Timed</th></tr></thead><tbody>${steps.join('')}</tbody></table></div></section>
    <section class="card"><h2>Recent app canary runs</h2><p class="note">Newest first · last ${rows.length} of ${runs.length}</p>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Trigger</th><th>Result</th><th class="num">Took</th><th>Trainer</th><th>Alert</th><th></th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div></section>`
}

function drawAppCanaryCharts(runs) {
  const real = appReal(runs)
  if (!real.length) return
  const common = (fmt, scale, source) => ({
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { align: 'start', labels: { color: css('--ink-2'), usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
      tooltip: { callbacks: { label: (item) => ` ${item.dataset.label}: ${fmt(item.parsed.y)}` } },
    },
    scales: {
      x: { stacked: true, grid: { display: false }, border: { color: css('--axis') }, ticks: { color: css('--muted'), maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
      y: { stacked: true, ...scale, grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--muted'), maxTicksLimit: 5, callback: fmt } },
    },
    onClick: (_, els) => {
      const r = source?.[els[0]?.index]
      if (r?.run_url) window.open(r.run_url, '_blank', 'noopener')
    },
  })

  // Uptime per day: the last 30 days, oldest first.
  const days = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * APP_CANARY_DAY_MS)
    days.push(d.toISOString().slice(0, 10))
  }
  const byDay = new Map(days.map((d) => [d, []]))
  for (const r of real) {
    const key = String(r.timestamp).slice(0, 10)
    if (byDay.has(key)) byDay.get(key).push(r)
  }
  charts.push(
    new Chart(document.getElementById('c-app-canary-uptime'), {
      type: 'bar',
      data: {
        labels: days.map((d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
        datasets: [{ label: 'Uptime', data: days.map((d) => appUptime(byDay.get(d))), backgroundColor: css('--s3'), borderRadius: 3 }],
      },
      options: common((v) => (v == null ? '—' : `${Math.round(v)}%`), { min: 0, max: 100 }, null),
    }),
  )

  // Time per step, stacked, for the last 60 passing runs.
  const timed = real.filter(appUp).slice(-60)
  const names = appStepNames(runs)
  charts.push(
    new Chart(document.getElementById('c-app-canary-steps'), {
      type: 'bar',
      data: {
        labels: timed.map((r) => new Date(r.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })),
        datasets: names.map((name, i) => ({
          label: name,
          data: timed.map((r) => {
            const ms = appStepDuration(r, name)
            return ms == null ? null : ms / 1000
          }),
          backgroundColor: css(SLOTS[i % SLOTS.length]),
          stack: 'steps',
        })),
      },
      options: common((v) => dur(v * 1000), { beginAtZero: true }, timed),
    }),
  )
}
