// FitLog quality dashboard. Reads data/history.json (one record per CI run,
// appended by metrics/publish.sh) and renders everything in the browser: no
// build step, no server.
//
// Each run carries `sources: { e2e: {...}, unit: {...} }`. Sources of kind
// "tests" share one shape and feed every panel here, so another test suite
// shows up with no dashboard change. A new kind (e.g. "a11y" from axe, "load"
// from k6) is ignored until it gets panels of its own, so it can't break the page.

const LABELS = { e2e: 'E2E', unit: 'Unit' }
const ORDER = ['e2e', 'unit']
const SLOTS = ['--s1', '--s2', '--s3', '--s4']
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
    app.innerHTML = '<p class="empty">No runs yet. The next push to main or dev publishes here.</p>'
    return
  }
  const keys = sourceKeys(runs)
  app.innerHTML = [lastRun(runs.at(-1)), kpis(runs, keys), chartCards(runs, keys), tables(runs), recentRuns(runs, keys)].join('')
  if (window.Chart) drawCharts(runs, keys)
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
  return `<section class="grid kpis" aria-label="Summary">
    ${tile('Runs passing', `${green}/${recent.length}`, `last ${recent.length} runs, flaky still passes`)}
    ${tile('Flaky rate', ran ? pct((flaky / ran) * 100) : '—', `${flaky} flaky of ${ran} retry-enabled test results`)}
    ${durations.join('')}
  </section>`
}

function chartCards(runs, keys) {
  const card = (id, title, note) => `<div class="card"><h2>${title}</h2><p class="note">${note}</p><div class="chart"><canvas id="${id}" role="img" aria-label="${title} chart"></canvas></div></div>`
  return `<section class="grid two">
      ${card('c-pass', 'Pass rate', 'Tests that passed (incl. after a retry) ÷ tests run, per CI run')}
      ${card('c-flaky', 'Flaky rate', 'Tests that needed a retry to pass ÷ tests run (suites with retries)')}
    </section>
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

main()
