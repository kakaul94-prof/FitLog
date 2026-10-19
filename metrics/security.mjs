// Pure readers for the security scan reports (scripts/security-scan.sh), so
// they're unit-tested in security.test.mjs. Each turns one tool's report into
// { tool, counts, findings } and never copies anything secret: gitleaks runs
// with --redact, and only rule ids and file paths are kept from it.

const RISK = ['informational', 'low', 'medium', 'high'] // ZAP's riskcode 0..3

/** gitleaks JSON: an array of findings. */
export function readGitleaks(report) {
  const findings = (report ?? []).map((f) => `${f.RuleID} in \`${f.File}\`${f.Commit ? ` (${f.Commit.slice(0, 7)})` : ''}`)
  return { tool: 'Secrets (gitleaks)', counts: { secrets: findings.length }, findings }
}

/** npm audit --json (v7+): totals by severity, plus the affected packages. */
export function readNpmAudit(report) {
  const v = report?.metadata?.vulnerabilities ?? {}
  const counts = { critical: v.critical ?? 0, high: v.high ?? 0, moderate: v.moderate ?? 0, low: v.low ?? 0 }
  const findings = Object.values(report?.vulnerabilities ?? {}).map((p) => `${p.name} (${p.severity}${p.isDirect ? ', direct' : ''})`)
  return { tool: 'Node dependencies (npm audit)', counts, findings }
}

/** pip-audit -f json: one entry per pinned package, with any known advisories. */
export function readPipAudit(report) {
  const deps = report?.dependencies ?? []
  const findings = deps.flatMap((d) => (d.vulns ?? []).map((v) => `${d.name} ${d.version}: ${v.id}${v.fix_versions?.length ? ` (fixed in ${v.fix_versions.join(', ')})` : ''}`))
  return { tool: 'Python dependencies (pip-audit)', counts: { advisories: findings.length, packages: deps.length }, findings }
}

/** ZAP baseline -J: alerts per site, each with a riskcode and an instance count. */
export function readZap(report) {
  const counts = Object.fromEntries(RISK.toReversed().map((r) => [r, 0]))
  const findings = []
  for (const site of report?.site ?? []) {
    for (const a of site.alerts ?? []) {
      const risk = RISK[Number(a.riskcode)] ?? 'informational'
      counts[risk] += 1
      findings.push(`${risk}: ${a.name ?? a.alert} (${a.count ?? a.instances?.length ?? 1} URLs)`)
    }
  }
  return { tool: 'Running app (OWASP ZAP baseline)', counts, findings }
}

const describeCounts = (counts) => Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')

/** Markdown for the job summary. `results` maps a report file to its reading, or null if missing. */
export function securityMarkdown(results) {
  const out = ['### 🔒 Security scans (report only, not a release gate)', '', '| Scan | Result | Report |', '|---|---|---|']
  for (const [file, r] of Object.entries(results)) {
    out.push(r ? `| ${r.tool} | ${describeCounts(r.counts)} | \`${file}\` |` : `| — | no report (scan did not run) | \`${file}\` |`)
  }
  for (const r of Object.values(results).filter((x) => x?.findings.length)) {
    out.push('', `<details><summary>${r.tool}: ${r.findings.length} finding(s)</summary>`, '', ...r.findings.map((f) => `- ${f}`), '', '</details>')
  }
  return out.join('\n') + '\n'
}
