// The commit being served, for Sentry's `release` tag in the browser bundle
// AND in the Pages Functions, so one commit's errors and its source maps line
// up. 'local' is the committed value. scripts/gen-release.mjs (the prebuild
// hook) rewrites it with the commit SHA when a GitHub Actions or Cloudflare
// Pages build says which commit it is building; a local build leaves it alone.
// Never edit by hand, never commit a SHA here.
export const RELEASE = 'local'
