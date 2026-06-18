# Deploying FitLog (Cloudflare Pages)

Your app is a static site that talks to Supabase. Hosting is free. It now runs as
**two environments** — a `dev` playground and a `prod` site for real users.

## Environments

| Branch | Cloudflare project | URL | Supabase project | Who uses it |
|--------|--------------------|-----|------------------|-------------|
| `dev`  | `fitlog`      | `fitlog-9wl.pages.dev`  | dev  | you — testing playground (your own data lives here) |
| `main` | `fitlog-prod` | `fitlog-prod.pages.dev` | prod | real users (separate DB, started empty) |

The two Supabase projects are **separate databases** — separate logins and data,
nothing shared. Each Cloudflare project has its own env vars pointing at its own
Supabase. Sections 1–3 below are the per-project wiring (run once for each).

### Day-to-day workflow

- **Build / test:** work on `dev` → `git push` → check `fitlog-9wl.pages.dev`.
- **Release to users:** merge dev into main —
  ```bash
  git checkout main && git merge dev && git push && git checkout dev
  ```
  → deploys `fitlog-prod`. **Pushing to `main` ships to real users — treat it as production.**

## 1. The GitHub repo

One repo (`github.com/kakaul94-prof/FitLog`) feeds both projects; the **branch**
decides which site builds. Initial setup, for reference:

```bash
git init && git add -A && git commit -m "FitLog"
git branch -M main
git remote add origin https://github.com/<you>/fitlog.git
git push -u origin main
git checkout -b dev && git push -u origin dev
```

## 2. Create a Cloudflare Pages project (once per environment)

1. dash.cloudflare.com → **Workers & Pages** → **Create application** → **Pages** → **Import an existing Git repository** → pick `FitLog`.
2. **Project name:** `fitlog` for dev, `fitlog-prod` for prod (must match the Supabase Site URL in §3).
3. Build settings:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. **Environment variables** (Settings → Variables and secrets) — add all three, pointing at **this environment's** Supabase:
   - `VITE_SUPABASE_URL` — the **bare** project URL `https://<ref>.supabase.co`. **Not** the REST endpoint (`…/rest/v1/`) — that causes `Invalid path specified in request URL` at sign-in.
   - `VITE_SUPABASE_ANON_KEY` — newer Supabase projects show keys as `sb_publishable_…` / `sb_secret_…`. Use the **publishable** key here; **never** the secret one (it bypasses RLS).
   - `VITE_USDA_API_KEY`
5. **Workers AI binding** (powers "Scan nutrition label"; Settings → Functions/Bindings — you may need one deploy first): add a **Workers AI** binding named **`AI`**. Needed on **both** projects, or label scanning breaks for that environment. No API key — uses Cloudflare's free Workers AI allowance; nothing is exposed to the browser.
6. **Save and Deploy.**

### Branch control (this is what separates dev from prod)

Settings → **Build → Branch control** on each project:

- **`fitlog-prod`:** Production branch = `main`; **Preview branch = None** (so untested `dev` code never builds/runs against the prod database).
- **`fitlog`:** Production branch = `dev` (its env vars point at dev Supabase, so the `dev` build is your dev site). "Production" is just Cloudflare's name for the project's main URL — it's still your testing site.

## 3. Point each Supabase project's auth at its live URL

In **each** Supabase project → **Authentication → URL Configuration**:

- **prod** project → Site URL `https://fitlog-prod.pages.dev`, Redirect URLs `https://fitlog-prod.pages.dev/**`
- **dev** project → Site URL `https://fitlog-9wl.pages.dev`, Redirect URLs `https://fitlog-9wl.pages.dev/**` (+ `http://localhost:5173/**` for local `npm run dev`)

## 4. Install it on your phone

Open the URL on your phone → browser menu → **Add to Home Screen**. It launches
full-screen with its own icon, like a native app.

## Notes

- **Env vars bake in at build time** (Vite `VITE_` vars). After changing one in Cloudflare, **Retry deployment** (Deployments → latest → ⋯ → Retry) — editing alone won't update the live site.
- **Updating:** push to a branch and the matching site rebuilds — `dev` → dev site, `main` → prod site.
- **Auth emails (prod):** the default Supabase mailer is rate-limited and lands in spam, so real-user signup-confirmation / password-reset emails are unreliable until you set **custom SMTP** (Authentication → Emails/SMTP). Meanwhile, confirm users manually in **Authentication → Users**, or temporarily disable "Confirm email".
- **NordVPN:** its Threat Protection DNS filter blocks `supabase.co`. If the app can't load data with the VPN on, allowlist `*.supabase.co` in NordVPN → Settings → Threat Protection, or disable Threat Protection.
- **Label scanning:** lives in a Pages Function (`functions/api/scan-label.ts`) that only runs on Cloudflare. Plain `npm run dev` won't serve it — test scanning on a deployed site, or run `npx wrangler pages dev dist --ai AI` after a build.
- **Your data:** More → "Export my data (JSON)" downloads a full backup anytime.
