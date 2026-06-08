# Deploying FitLog (Cloudflare Pages)

Your app is a static site that talks to Supabase. Hosting is free.

## 1. Push the project to GitHub

```bash
git init && git add -A && git commit -m "FitLog"
# create an empty repo on GitHub, then:
git branch -M main
git remote add origin https://github.com/<you>/fitlog.git
git push -u origin main
```

## 2. Create the Cloudflare Pages project

1. dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick the repo.
2. Build settings:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. **Environment variables** (Settings → Environment variables) — add all three:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_USDA_API_KEY`
4. **Workers AI binding** (powers "Scan nutrition label"; Settings → Functions → Bindings — you may need one deploy first): add a **Workers AI** binding with the variable name **`AI`**. No API key needed — it uses Cloudflare's free Workers AI allowance, and nothing is exposed to the browser.
5. **Save and Deploy.** You'll get a URL like `https://fitlog.pages.dev`.

## 3. Point Supabase auth at the live URL

Supabase → **Authentication → URL Configuration**:

- **Site URL:** `https://fitlog.pages.dev`
- **Redirect URLs:** add `https://fitlog.pages.dev/**`

(Keep `http://localhost:5173/**` too if you still run it locally.)

## 4. Install it on your phone

Open the URL on your phone → browser menu → **Add to Home Screen**. It launches
full-screen with its own icon, like a native app.

## Notes

- **NordVPN:** its Threat Protection DNS filter blocks `supabase.co`. If the app
  can't load data with the VPN on, allowlist `*.supabase.co` in NordVPN →
  Settings → Threat Protection, or disable Threat Protection.
- **Updating:** push to GitHub → Cloudflare auto-rebuilds and deploys.
- **Label scanning:** lives in a Pages Function (`functions/api/scan-label.ts`) that only runs on Cloudflare. Plain `npm run dev` won't serve it — test scanning on the deployed site, or run `npx wrangler pages dev dist --ai AI` after a build.
- **Your data:** More → "Export my data (JSON)" downloads a full backup anytime.
