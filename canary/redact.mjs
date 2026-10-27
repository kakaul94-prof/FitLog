// What may go from a canary run into a public place (a GitHub issue, the
// dashboard's JSON). Error text from Playwright can carry the page's text, a
// response body or a URL, so anything that looks like an email, a token or a
// key goes, and so do the monitor's own credentials wherever they appear.

const ANSI = /\u001b\[[0-9;]*m/g
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const JWT = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g
const SB_KEY = /\bsb_(?:publishable|secret)_[\w-]+/g
const BEARER = /\b(bearer\s+)[\w.~+/=-]+/gi
const QUERY = /(https?:\/\/[^\s?#'"]+)\?[^\s'"]*/g

/**
 * @param {string} text
 * @param {readonly string[]} [secrets] literal values to remove (the monitor's email and password)
 */
export function redact(text, secrets = []) {
  let out = String(text ?? '').replace(ANSI, '')
  for (const s of secrets) if (s) out = out.split(s).join('[redacted]')
  return out
    .replace(QUERY, '$1?[query]')
    .replace(BEARER, '$1[token]')
    .replace(JWT, '[jwt]')
    .replace(SB_KEY, '[key]')
    .replace(EMAIL, '[email]')
}

/** The credentials in this process's environment, for redact(). */
export const envSecrets = (env = process.env) => [env.CANARY_PASSWORD, env.CANARY_EMAIL].filter((s) => s && s.length >= 4)

/** The first line of an error, trimmed to fit a table cell. */
export function firstLine(text, max = 300) {
  const line = String(text ?? '').replace(ANSI, '').split('\n').find((l) => l.trim()) ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
