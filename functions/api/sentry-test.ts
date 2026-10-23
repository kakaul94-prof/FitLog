// Cloudflare Pages Function: GET /api/sentry-test
// Throws on purpose, so the error-tracking pipeline for the Functions can be
// proven on a deployed site: the event must arrive in Sentry tagged with the
// release and environment, with a readable stack, and with the email and the
// weight below scrubbed out of the message (shared/scrub.ts). Behind the
// sign-in gate like every /api route (functions/api/_middleware.ts), so an
// anonymous caller gets a 401 and nothing is spent; a signed-in caller gets
// Cloudflare's 500 page. The app never calls it.
export const onRequestGet = async (): Promise<Response> => {
  throw new Error('FitLog monitoring test: thrown on purpose in a Pages Function (reporter fake.user@example.com, 182.4 lb)')
}
