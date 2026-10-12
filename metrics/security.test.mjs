import { describe, expect, it } from 'vitest'
import { readGitleaks, readNpmAudit, readPipAudit, readZap, securityMarkdown } from './security.mjs'

describe('security report readers', () => {
  it('keeps only rule, file and short commit from gitleaks (never the secret)', () => {
    const r = readGitleaks([{ RuleID: 'jwt', File: 'src/x.ts', Commit: 'abcdef1234', Secret: 'REDACTED', Match: 'REDACTED' }])
    expect(r.counts).toEqual({ secrets: 1 })
    expect(r.findings).toEqual(['jwt in `src/x.ts` (abcdef1)'])
    expect(JSON.stringify(r)).not.toContain('REDACTED')
  })

  it('totals npm audit by severity', () => {
    const r = readNpmAudit({
      metadata: { vulnerabilities: { critical: 0, high: 1, moderate: 2, low: 0, info: 0, total: 3 } },
      vulnerabilities: { vite: { name: 'vite', severity: 'high', isDirect: true } },
    })
    expect(r.counts).toEqual({ critical: 0, high: 1, moderate: 2, low: 0 })
    expect(r.findings).toEqual(['vite (high, direct)'])
  })

  it('lists pip-audit advisories with their fixed versions', () => {
    const r = readPipAudit({
      dependencies: [
        { name: 'httpx', version: '0.28.1', vulns: [] },
        { name: 'jinja2', version: '3.0.0', vulns: [{ id: 'GHSA-xxxx', fix_versions: ['3.1.6'] }] },
      ],
    })
    expect(r.counts).toEqual({ advisories: 1, packages: 2 })
    expect(r.findings).toEqual(['jinja2 3.0.0: GHSA-xxxx (fixed in 3.1.6)'])
  })

  it('counts ZAP alerts by risk', () => {
    const r = readZap({
      site: [{ alerts: [{ name: 'CSP header not set', riskcode: '2', count: '4' }, { name: 'Timestamp disclosure', riskcode: '0', count: '1' }] }],
    })
    expect(r.counts).toEqual({ high: 0, medium: 1, low: 0, informational: 1 })
    expect(r.findings[0]).toBe('medium: CSP header not set (4 URLs)')
  })
})

describe('securityMarkdown', () => {
  it('shows a row per scan, marks missing reports, and folds the details', () => {
    const md = securityMarkdown({
      'gitleaks.json': readGitleaks([]),
      'zap.json': null,
    })
    expect(md).toContain('| Secrets (gitleaks) | 0 secrets | `gitleaks.json` |')
    expect(md).toContain('| — | no report (scan did not run) | `zap.json` |')
    expect(md).not.toContain('<details>')
  })
})
