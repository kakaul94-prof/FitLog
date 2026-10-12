# Security findings

Every real issue the API suite (`api-tests/`) or the security scans
(`make test-security`, the CI "Security scans" job) have found: what it was, how
serious, how it was fixed, and which test now guards it. A finding is never
"fixed" by weakening a test: the test is written first, fails, and the fix is
its own commit.

Severity is for this app: a personal tracker where each account sees only its
own data, hosted on Cloudflare Pages with Supabase.

## Summary

| ID | Finding | Severity | Status |
|---|---|---|---|
| [F-01](#f-01-ai-endpoints-answered-anyone-with-the-url) | AI endpoints answered anyone with the URL | High | Fixed |
| [F-02](#f-02-rows-could-link-to-another-users-rows) | Rows could link to another user's rows | Medium | Fixed (migration to run) |
| [F-03](#f-03-the-trainers-cost-cap-could-be-bypassed) | The trainer's cost cap could be bypassed | Medium | Fixed |
| [F-04](#f-04-upstream-error-details-and-a-key-fingerprint-reached-the-browser) | Upstream error details and a key fingerprint reached the browser | Low | Fixed |
| [F-05](#f-05-unbounded-text-and-500s-that-exposed-database-internals) | Unbounded text, and 500s that exposed database internals | Low | Fixed (migration to run) |
| [F-06](#f-06-recipe-import-url-guard-gaps) | Recipe-import URL guard gaps (IPv6, redirects) | Low | Fixed |
| [F-07](#f-07-a-silent-claude-held-the-trainer-open) | A silent Claude held the trainer open | Low | Fixed |
| [F-08](#f-08-long-chats-could-start-on-an-assistant-turn) | Long trainer chats could start on an assistant turn | Low (bug) | Fixed |
| [F-09](#f-09-an-unusable-answer-showed-an-empty-bubble) | An unusable answer showed an empty bubble | Low (bug) | Fixed |
| [A-01 to A-05](#accepted-risks) | Platform behaviours, documented and accepted | Informational | Accepted |
| [S-01 to S-04](#scan-results) | Secret, dependency and ZAP scans | Up to critical (dependencies) | 2 clean, 2 partly fixed |

The two schema fixes ship as migrations that must be run on each hosted
database (dev, then prod) from the Supabase SQL Editor. Both check the existing
data first and change nothing if it would break:

- `supabase/migration_owner_scoped_links.sql` (F-02)
- `supabase/migration_text_limits.sql` (F-05)

---

## Fixed

### F-01: AI endpoints answered anyone with the URL

**Severity: High.** `/api/scan-plate`, `/api/import-recipe` and `/api/scan-label`
did no authentication. Anyone who found the URL could spend the Claude credit and
Workers AI quota, and `/api/import-recipe` would fetch arbitrary web pages on
their behalf. Only `/api/trainer` checked the caller.

**Fix:** one Pages middleware (`functions/api/_middleware.ts`) checks the
Supabase session for every `/api` route before any work is done. It validates
the token with the auth server rather than locally, so a signed-out token is
refused at once. The app sends the session with every AI call (`src/lib/apiAuth.ts`).

**Guarded by:** `tests/functions/test_ai_endpoints.py::test_signed_out_callers_are_refused`,
`::test_a_session_that_was_signed_out_is_refused` (all four endpoints), and the
forged-token matrix in `tests/auth/test_tokens.py` (functions surface).

### F-02: Rows could link to another user's rows

**Severity: Medium.** Row-level security checks the owner of the row being
written, but Postgres checks a foreign key *without* RLS. So user B could
attach their own diary entries, sets, meal items or recipe ingredients to user
A's foods, workouts, meals and routines (all 10 links between user tables). B
couldn't read A's data, but:

- B's recipe ingredient pointing at A's food (`ON DELETE RESTRICT`) stopped A
  deleting their own food (409).
- A's deletes cascaded into, or nulled out, rows A couldn't see.
- A successful link confirmed that a row id existed.

**Fix:** each link now includes the owner: `(food_id, user_id) references
foods(id, user_id)`, with `on delete set null (food_id)` for optional links so
the owner column is never touched. Both rows must belong to the same user.

**Guarded by:** `tests/validation/test_cross_user_references.py` (every link,
plus the two proven consequences), its catalog test that every foreign key between
user tables includes `user_id`, and the BDD scenarios "You can't hang your sets
off someone else's workout" and "You can't use someone else's food in your recipe".

### F-03: The trainer's cost cap could be bypassed

**Severity: Medium (cost).** `/api/trainer` caps each message at 4,000
characters, but merged back-to-back user turns without re-applying the cap. A
prompt split across many turns went through whole: a 10,003-character message
reached Claude in the test, and there was no upper bound.

**Fix:** a merged turn is re-capped.
**Guarded by:** `tests/functions/test_trainer.py::test_back_to_back_messages_are_merged_but_still_capped`.

### F-04: Upstream error details and a key fingerprint reached the browser

**Severity: Low.** When Claude refused a request, the functions returned up to
400 characters of Claude's raw error body (with its request id) as `detail`,
and on a key failure, `keyShape`: the key's first eight characters and its
length. Not the key, but internals a browser has no use for.

**Fix:** every function error is now `{"error": "<one readable message>"}`; the
upstream body and the key's length go to the function log instead.
**Guarded by:** the `FunctionError` contract (extra fields fail) in
`tests/functions/`, and `tests/security/test_sensitive_data.py`, which also checks
the trainer never returns its system prompt, the user's log or the key.

### F-05: Unbounded text, and 500s that exposed database internals

**Severity: Low.** No text column had a size limit. A 100 KB food name got
`500 index row requires 60056 bytes, maximum size is 8191` (Postgres internals,
and the wrong status for bad input); notes, pain and other names silently
stored whatever arrived.

**Fix:** all 39 free-text columns have a generous length CHECK (300 characters
for food names, 200 for other names, 10,000 for notes, less for keys and units),
so oversized input gets a clean 400 and is never stored.
**Guarded by:** `tests/validation/test_payload_limits.py`, including realistic
long values that must still save, and a catalog test that fails if a new text
column has no limit.

### F-06: Recipe-import URL guard gaps

**Severity: Low** (Cloudflare's edge can't reach private networks, so this was
defence in depth). The guard that stops `/api/import-recipe` fetching internal
addresses missed IPv4-mapped IPv6 (`http://[::ffff:7f00:1]/`), and redirects were
followed without being checked.

**Fix:** recipe links must be web addresses: no IP literals of any kind, no
local-only names. Redirects are followed by hand, at most three, each checked
like the original link.
**Guarded by:** `tests/functions/test_ai_endpoints.py::test_import_recipe_refuses_internal_and_odd_urls_before_fetching`
(18 URL forms). The redirect check has no automated test: it needs a public
hostname that redirects, which the offline suite deliberately doesn't use.

### F-07: A silent Claude held the trainer open

**Severity: Low (availability).** The trainer's call to Claude had no timeout,
so an upstream that never answered held the user's spinner until Cloudflare
killed the request.

**Fix:** if Claude hasn't started answering within 20 seconds the trainer
returns 504 with a clear message. Once the stream starts it isn't cut off.
**Guarded by:** `tests/functions/test_trainer.py::test_a_silent_claude_times_out_in_seconds`
(the test server shortens the limit to 2 s).

### F-08: Long chats could start on an assistant turn

**Severity: Low (bug).** The trainer keeps the last 12 turns. A chat always
ends on the user's question, so from about the seventh question the trimmed
history began with an assistant reply, which the Messages API rejects (per the
function's own comment; not reproduced against the live API).

**Fix:** leading assistant turns are dropped after trimming, not before.
**Guarded by:** `tests/functions/test_trainer.py::test_history_is_trimmed_to_the_last_12_turns_starting_with_the_user`.

### F-09: An unusable answer showed an empty bubble

**Severity: Low (bug).** A "successful" response with no usable text (a
proxy's error page, a garbled or empty stream) left the chat bubble empty.

**Fix:** the trainer says it didn't get an answer, as it already did for refusals.
**Guarded by:** `tests/functions/test_trainer.py::test_an_answer_with_no_usable_text_is_not_shown_as_an_empty_bubble`.

---

## Accepted risks

Observed, understood, and not worth a code change for this app. Each is
recorded so it's a decision, not an oversight.

| ID | Behaviour | Why it's accepted |
|---|---|---|
| A-01 | A token signed with the project's own secret but a different audience (`aud`) is accepted by the database API, auth and storage. | Minting one needs the JWT secret, which only Supabase holds, and Supabase only issues `aud: authenticated`. Forged and edited tokens, including an edited `aud`, are refused (`tests/auth/test_tokens.py`). |
| A-02 | After sign-out, an access token keeps working on the database API until it expires (up to 1 hour). | Standard for stateless JWTs. The auth API and every `/api` function check the session and refuse it at once (`test_sign_out_ends_the_session_for_the_auth_api`, `test_a_session_that_was_signed_out_is_refused`). |
| A-03 | Replaying an old refresh token is refused, but in Supabase Auth 2.197 the rest of that session carries on. | Auth-server behaviour, not app code. The replay itself is refused (`test_replaying_an_old_refresh_token_is_refused`). |
| A-04 | The database API's schema description (table and column names) is readable with the public anon key. | Supabase default; the same schema is public in this repository. No row data is exposed. |
| A-05 | The trainer streams Claude's reply verbatim, so Claude could repeat its system prompt if asked. | The prompt holds no secrets, only the asking user's own data; output filters are easily bypassed and would break streaming. The function itself never returns the prompt, the key or another user's data (`tests/security/test_sensitive_data.py`). |

---

## Scan results

Latest local run of `make test-security`. CI runs the same script on every
push and pull request; the reports are the `security-reports` artifact and the
summary is in the job's summary page.

| ID | Scan | Result | Status |
|---|---|---|---|
| S-01 | Secrets (gitleaks, full history) | 0 secrets in 334 commits across all branches, and in the working tree | Clean |
| S-02 | Python dependencies (pip-audit) | 0 known vulnerabilities in 61 packages | Clean |
| S-03 | Node dependencies (npm audit) | 15 advisories: 2 critical, 9 high, 4 moderate | 3 fixed, 15 open |
| S-04 | Running app (OWASP ZAP baseline) | 0 high; 5 medium, 1 low, 3 informational after the header fix | Partly fixed |

### S-01: Secrets — clean

Nothing secret has ever been committed. The two things gitleaks flags are
allowlisted in `.gitleaks.toml` with the reason: the Supabase CLI's public local
development keys (`iss: supabase-demo`, the same on every machine) and the fake
secrets in `api-tests/tests/security/test_leak_scanner.py` that prove the leak
scanner works.

### S-02: Python dependencies — clean

All 61 packages the API suite resolves to (exact pins in
`api-tests/requirements.txt`) have no known advisories.

### S-03: Node dependencies — 15 open

**Fixed:** `wrangler` 4.136.1 → 4.149.0, which cleared 3 high advisories
(`wrangler`, `miniflare`, `undici`). It runs the Pages Functions locally for the
API tests and was added by this work.

**Open.** Upgrading these changes the app and the Android build, so each needs
its own tested change:

| Package | Severity | Ships to users? | Proposed fix |
|---|---|---|---|
| `@capacitor/android` | critical | **Yes**, the Android app (remote content could load at the app's origin through the internal proxy path) | Compatible update, then rebuild and test the Android app |
| `react-router`, `react-router-dom` | high / moderate | **Yes**, the web app (open redirect through a backslash in a link) | Compatible update |
| `sharp` | high | No: build-time icon generation | Major version update |
| `tar`, `postcss`, `browserslist`, `nanoid`, `source-map-js`, `brace-expansion`, `fast-uri`, `@xmldom/xmldom`, `baseline-browser-mapping`, `vitest`, `@vitest/mocker` | critical to moderate | No: build and test tooling only (`npm ls --omit=dev` finds none of them) | `npm audit fix` |

### S-04: Running app (ZAP baseline) — partly fixed

**Fixed** by `public/_headers`: no anti-clickjacking header, no
Cross-Origin-Opener-Policy, no Permissions-Policy. The app now refuses to be
framed, keeps its window to itself and switches off the browser features it
never uses. Camera (barcode, form videos), location (GPS cardio) and Bluetooth
(heart-rate strap) are untouched.

**Open: a full Content-Security-Policy.** The four "CSP: ..." alerts (no
`default-src` fallback, wildcard, `unsafe-inline` for scripts and styles) are one
gap: the header only sets `frame-ancestors`. A complete policy has to allow
Supabase, USDA and Open Food Facts, `blob:` form-video playback, the service
worker and the app's inline styles. It needs testing on the deployed app and the
Android build, so it's a separate change. The proposal is to ship it as
`Content-Security-Policy-Report-Only` first, then enforce it.

**Accepted:**
- *Cross-Domain Misconfiguration*: Cloudflare Pages serves static files with
  `Access-Control-Allow-Origin: *`. Those files are public anyway, and the API
  uses bearer tokens, not cookies.
- *Cross-Origin-Embedder-Policy*: requiring it would block the cross-origin
  food photos and video the app loads, for no benefit (the app uses no
  `SharedArrayBuffer`).
- The three informational notes (a comment in the minified bundle, "modern web
  application", cache headers).
