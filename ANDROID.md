# ANDROID.md — shipping FitLog as an Android app

Plan for wrapping the existing FitLog PWA as a native Android app with **Capacitor**
and distributing it via the **Play Store Internal testing track**. This is a wrapping
job, not a rewrite — all React/Tailwind/TanStack code and the Supabase backend are
reused unchanged.

> Status: **planning doc, nothing built yet.** Work through the phases in order.

## Decisions (locked)

- **Wrapper:** Capacitor (loads the live site in a native WebView; full native API access).
- **Content source:** **live URL** → the app loads `https://fitlog-9wl.pages.dev` (prod).
  Your existing *push to `main` → Cloudflare redeploy* flow IS the app's update channel —
  no rebuild/re-upload for UI changes.
- **Platform:** Android first (all buildable on the Windows PC). iOS deferred (needs a Mac).
- **Distribution:** Play **Internal testing** track — installs via Play on up to 100
  devices with auto-updates; skips the 12-tester/14-day rule that gates public Production.
- **App ID:** `app.fitlog.mobile` (suggested; reverse-DNS, **permanent once uploaded** — pick before Phase 4).

### Trade-off to remember
Live-URL means a **cold launch with no internet shows a blank screen** (the native shell
has no bundled fallback). The deployed site's service worker (vite-plugin-pwa) gives *some*
offline caching, which softens this. Acceptable for a connected personal tracker. If it ever
bites, the fix is to switch to bundled assets — same store package, just a config change.

---

## Phase 1 — Tooling & Capacitor setup

**Install once (Windows):**
- **Android Studio** (bundles the Android SDK, platform tools, and an emulator). On first
  launch let it install the SDK + create a virtual device.
- Node is already installed (this repo builds with it).

**Add Capacitor to the project:**
```bash
npm i @capacitor/core @capacitor/cli @capacitor/android
npx cap init "FitLog" "app.fitlog.mobile" --web-dir dist
npm run build            # produces dist/ (fallback web assets)
npx cap add android      # creates the android/ native project
```

**Point the app at the live site** — edit `capacitor.config.ts`:
```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.fitlog.mobile',
  appName: 'FitLog',
  webDir: 'dist',
  server: {
    url: 'https://fitlog-9wl.pages.dev',
    androidScheme: 'https',
  },
};
export default config;
```

```bash
npx cap sync     # copy config + plugins into android/
npx cap open android   # opens the project in Android Studio
```

> Note: because content is loaded from the live URL, the Capacitor plugin JS used below must
> be part of the **deployed** bundle (it ships with the same code that's pushed to Cloudflare).
> On the website those calls are inert; inside the app they activate. Guard native-only calls
> with `Capacitor.isNativePlatform()` so the web build is unaffected.

---

## Phase 2 — Native feature swaps

Each of these is a small, isolated change. Exact code TBD when we read the current
implementations (`scan`/`FoodFormPage`, rest-timer component).

| Feature | Today (web) | Native plan | Plugin |
|---|---|---|---|
| Rest-timer alert | Web Notification (done-banner only) | Schedule one local notification at timer end (keep done-banner-only — no per-second countdown) | `@capacitor/local-notifications` |
| Label scan camera | `getUserMedia` | Native photo capture → feed image into the existing 2-step Workers AI flow | `@capacitor/camera` |
| Android hardware Back | n/a | Navigate router back; exit app at root | `@capacitor/app` |
| Status bar / notch | n/a | Set status-bar color; respect `env(safe-area-inset-*)` | `@capacitor/status-bar` |
| Splash / icon | PWA icons | Generate from `public/icon.svg` | `@capacitor/assets`, `@capacitor/splash-screen` |

**Auth:** email/password works as-is (no redirect). Magic-link stays web-only for now
(would need deep-link config). No change needed for Phase 1 launch.

**Service worker:** leave the deployed PWA SW in place — with live-URL it provides partial
offline caching inside the app. (The "disable the SW" note only applies if we ever switch to
bundled assets.)

**AndroidManifest permissions** to add as features land: `CAMERA` (scan),
`POST_NOTIFICATIONS` (Android 13+ local notifications). `INTERNET` is automatic.

---

## Phase 3 — First run & test

```bash
npm run build && npx cap sync
npx cap open android
```
In Android Studio: pick the emulator or your plugged-in phone (enable USB debugging) and
press **Run**. Verify: app loads the live site, sign-in works, diary/lift/scan/timer work,
Back button behaves, notification fires.

---

## Phase 4 — Signing & the release build

Google requires a **signed AAB** (Android App Bundle).

1. In Android Studio: **Build → Generate Signed App Bundle / APK → Android App Bundle**.
2. Create a new **keystore** (key alias + passwords). **Back this up off the C: drive**
   (C: runs near-full) — losing it complicates future updates.
3. Build the **release** AAB → output at
   `android/app/build/outputs/bundle/release/app-release.aab`.
4. Google's **Play App Signing** (default) manages the real distribution key; your keystore
   is the *upload* key.

> Each upload must bump `versionCode` (integer) in `android/app/build.gradle`; bump
> `versionName` (e.g. `1.0.1`) for human-readable versions.

---

## Phase 5 — Play Console & Internal testing

**Account (one-time):**
- Create a **Google Play Console** account — **$25, one-time**. Register as an **individual**
  (no D-U-N-S needed).
- Complete **identity verification** (name, address, phone) — can take hours to days; start early.

**Create the app & required declarations:**
- New app → name `FitLog`, language, "App", "Free".
- **App content** (required even for internal testing):
  - **Privacy policy URL** — required (health/nutrition data). We'll add a `/privacy` page to
    the site or host a static one on Cloudflare.
  - **Data safety** — declare: account email + health/fitness logs + body measurements;
    encrypted in transit (HTTPS) and at rest (Supabase, RLS owner-only); not sold/shared;
    deletion available on request.
  - **Content rating** questionnaire (IARC), **target audience**, **ads = none**, news = no.

**Release to Internal testing:**
- **Testing → Internal testing → Create release** → upload `app-release.aab` → add release notes.
- **Testers:** create an email list (your Google account + family). Up to 100.
- **Roll out**, then copy the **opt-in URL**, open it on each phone, accept, and install via Play.
- First review (even internal) is usually quick; later updates faster.

**After launch:** UI changes ship automatically via the live URL (push to `main`). You only
re-upload an AAB when something *native* changes (a new plugin, permission, icon, or app ID).

---

## Deferred (not now)

- **iOS** — needs macOS + Xcode (own a Mac, rent a cloud Mac ~$20–30/mo, or CI like Codemagic).
  When started, decide bundled vs OTA hot-code-push (e.g. Capgo) to satisfy Apple's review.
- **Public Production listing** — only if you later want it publicly searchable; that triggers
  the 12-tester/14-day requirement. The build/AAB is identical, so no rebuild needed.

## Costs

| Item | Cost |
|---|---|
| Capacitor + plugins | Free |
| Android Studio | Free |
| Google Play Console | **$25 one-time** (no renewal) |
| iOS (later) | Apple Developer $99/yr + Mac access |

> Google occasionally changes Console requirements and target-API rules — verify specifics
> in the Console when you get there.
