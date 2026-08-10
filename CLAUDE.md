# FitLog — project guide for Claude

Personal, phone-first PWA to track calories/food (macros + micros), cardio,
strength, and body weight — with barcode/photo/label food scanning, GPS + HR-zone
cardio, per-exercise form videos, and data-driven (adaptive-TDEE) insights.
Single user, cloud-synced via Supabase. Modeled on the old MyFitnessPal.

## Features (shipped)

Pointers only; the mechanics live in **Domain logic** / **Data model** below.

- **Food & diary:** barcode scan (`barcode.ts` — native BarcodeDetector → Open Food Facts + USDA Branded, names source & flags disagreements), AI meal-photo scan (`scanPlate.ts`/`ScanMealPage`), nutrition-label OCR (`scanLabel.ts`), USDA search import (`usda.ts`/`UsdaSearchPage`), recipes + web-URL import (`importRecipe.ts`), reusable meals, daily supplements (`useDailySupplements`), food streak.
- **Nutrition insight:** adaptive/data-driven TDEE from logged intake + weigh-ins (`useAdaptiveTDEE` + `estimateAdaptiveTDEE`), 31-micronutrient + macro tracking, non-retroactive calorie-goal history, nutrition/micronutrient trend charts (`features/insights`).
- **Cardio:** MET / distance / manual logging, GPS distance recorder (`geo.ts`/`geoWatch.ts`/`ExerciseTrackPage`), HR zones 1–5 + time-in-zone (`zones.ts`, `hrZones` in `calc.ts`), distance & zone trends.
- **Strength:** workouts/sets/supersets, routines + `/program` rotation, est 1RM + progression, per-exercise form-video upload (`useFormVideos`), exercise notes, custom exercises, muscle-volume + body heatmap (`MuscleVolumePage`/`BodyHeatmap`), muscle & strength goals, workout calendar, rest timer (native notification), **Ask-a-trainer chat** (`/lift/trainer` — streaming Claude Haiku via `functions/api/trainer.ts`, grounded in a snapshot of your own log built by `trainerContext.ts` plus saved trainer memory).
- **Body:** weight + body measurements, BMI.
- **Platform:** installable PWA, Capacitor Android (native rest-timer, meal-reminder + streak-nudge notifications (`reminders.ts`), read-only Health Connect passive steps + smart-scale weight sync (`useWeightSync`/`weightSync.ts`), biometric app-lock (`biometric.ts`/`LockGate` + native `BiometricAuthPlugin.kt`), session auto-refresh across backgrounding (`authRefresh.ts`)), offline read, data export/import, More → Patch Notes.

**Not built (biggest gaps vs. mainstream apps):** water/hydration logging, sleep tracking, intermittent-fasting timer, two-way wearable / Apple Health / Fitbit sync. Social/community is intentionally out of scope (single-user).

## Working style

- Be token-frugal. Verify changes with `npm run build` (tsc + vite) — do **not**
  start the dev server or load the preview tools unless explicitly asked; UI is
  tested on the deployed app.
- Confirm scope before large or multi-step exploration/refactors.
- When I ask for an enhancement (especially at the start of a new session), read `EnhancementsPlanning.txt` first — it's the running backlog (items marked `[DONE]` are shipped). Confirm which item to build before coding.
- Commit subjects are user-facing — More → Patch Notes auto-lists the last 5 **pushes**, each grouping its commit titles (`scripts/gen-patchnotes.mjs`, runs on build; commits within 2h of each other = one push); write clean one-line subjects.

## Stack

- React 19 + Vite + TypeScript, Tailwind v4, React Router (lazy routes), TanStack Query
- Supabase (Postgres + Auth: email+password sign-in, magic-link fallback; password set/changed in Profile) — RLS owner-only on every table
- lucide-react, vite-plugin-pwa (installable); charts are hand-rolled SVG (`LineChartSvg`, macro donut in `NutrientBreakdown`) — no chart lib
- Host: Cloudflare Pages — `https://fitlog-9wl.pages.dev` (see `DEPLOY.md`). Repo: github.com/kakaul94-prof/FitLog

## Run / build / verify

- `npm run dev` (port 5173). `npm run build` (tsc + vite) — **always build-check before committing.**
- `npm test` (Vitest, `vitest run`) — fast unit tests for the **pure-logic libs** (`calc`, `nutrients`, `progression`, `date`); no backend/DOM. Co-located `src/lib/*.test.ts` (excluded from the build tsc via `tsconfig.app.json`); config in `vitest.config.ts`. `npm run test:watch` to iterate. Add cases here when you touch the math.
- Env (`.env`, gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_USDA_API_KEY`.
- **Self-test in preview:** dev exposes `window.__supabase`. Test user: `tester@fitlog.app` / `FitLogTester1!`. Sign in via `signInWithPassword`, then seed/drive via eval. Demo data lives in that account (not the owner's). The long-lived preview session can lapse — re-auth if inserts hit RLS errors.
- **Schema changes need SQL run in the Supabase SQL Editor** (anon client can't do DDL). SQL is in `supabase/schema.sql` (idempotent) + migration files.

## Conventions

- `src/pages/*` — one component per route (named export); routes + lazy-loading in `App.tsx`. Full-screen sub-pages route at top level (outside `AppLayout`); tabbed pages inside it.
- `src/features/<area>/use*.ts` — TanStack Query hooks per feature. Keys: `['diary',date]`, `['foods',search]`, `['workout',id]`, `['streak']`, `['exerciseHistory',key]`… Mutations invalidate the relevant keys.
- `src/lib/`: `supabase.ts` (**untyped** client — typed Database generic was dropped; domain interfaces applied at hook boundaries), `database.types.ts` (entity interfaces + nutrient keys), `calc.ts` (BMR/TDEE/goal, macros, 1RM, MET calories, BMI, moving average), `nutrients.ts` (31-nutrient reference + DV + USDA-id map + `sumNutrients`/`scaleNutrients`), `date.ts`, `usda.ts`.
- `src/components/ui/*` — small Tailwind+cva primitives (shadcn style, no CLI). `components/layout/*` = AppLayout, BottomNav (4 tabs: Diary/Lift/Progress/More), PageHeader. Shared: `NutrientBreakdown`, `NutrientFields`.
- Mobile-first: centered `max-w-md` frame. Theme tokens in `index.css` (green primary; use `bg-background`, `text-primary`, `cn()` from `lib/utils`).

## Data model (all RLS owner-only; `user_id` defaults to `auth.uid()`)

- `profiles` (1/user, auto-created on signup): sex, birth_date, height_cm, activity_level, goal_rate_lb_per_week, calorie_goal_mode + manual_calorie_goal, `macro_targets` jsonb, eat_back_exercise, units, `trainer_memory` jsonb (facts the Ask chat carries between sessions).
- `foods` — unified library (copy-on-save). `nutrients` jsonb = **per serving**, keyed by codes in nutrients.ts. **Recipes are foods** (`source='recipe'` + `recipe_servings`); ingredients in `recipe_ingredients`; per-serving nutrients recomputed + stored on the food.
- `diary_entries` — logged food; **snapshots** nutrients (per serving) + servings so past days don't change.
- `exercise_entries` — cardio. Built-in activities: `src/data/activities.ts` (MET); custom: `custom_activities`.
- Strength: `workouts` → `workout_exercises` (notes, superset_group) → `workout_sets` (reps, weight_lb, effort 1–5). Built-in lifts: `src/data/exercises.ts`; custom: `custom_exercises` (key `custom:<uuid>`). Templates: `routines` + `routine_exercises` (target sets/reps + superset_group).
- `measurements` — weight + optional body metrics, one row per reading; `source`='healthconnect' marks synced weigh-ins (null = manual).

## Domain logic

- **Calorie goal (hybrid):** Mifflin-St Jeor BMR × activity − deficit from goal rate; `manual` mode overrides; uses latest weight. (`calc.ts`)
- **Macros:** each macro set by g / g-per-lb / % / remainder; protein anchored in grams. `resolveMacroTargets`.
- **Streak (food only):** `useStreak` computes live from distinct food dates — consecutive run ending today (or yesterday = morning grace). NOT stored, so backfilling a missed day **heals** the gap. Shown 🔥 next to the diary date.
- **Cardio calories:** MET estimate or distance-based (walk/run/hike) or manual override; `eat_back_exercise` adds burned kcal to the diary's "remaining."
- **Strength:** sets grouped by workout_exercise; supersets = shared `superset_group` (linked block); est 1RM = Epley; progression = max weight / total volume / avg weight per session (`useExerciseHistory`); "last time" prefill on add.
- **Nutrient breakdown:** full panel, `—` for missing data (≠ 0), %DV, macro pie (calories/grams toggle). Reused for entry / day-total / food / recipe.

## Gotchas

- **NordVPN Threat Protection blocks `supabase.co`** → "Failed to fetch". Allowlist `*.supabase.co` or disable it.
- USDA imports arrive **per 100 g** — changing the serving size on the food form now auto-rescales the nutrients (`FoodFormPage`). Energy may arrive only under the Atwater ids (`2047`/`2048`) rather than `1008`; the importer falls back so calories don't import as `0` (`usda.ts`).
- Micros are only as complete as source data (USDA whole foods = full; branded/manual = sparse).
- Offline = read recent data; writes need a connection (v1).
- `public/_redirects` (`/* /index.html 200`) makes SPA deep links work on Cloudflare Pages.
- Never commit `.env`. PWA icons are generated from `public/icon.svg` via `node scripts/gen-icons.mjs`.

## Deploy

Cloudflare Pages ← GitHub repo. Build `npm run build`, output `dist`, set the 3 env vars; add the live URL to Supabase Auth → URL Configuration. Push to `main` → auto-redeploys (free, no tokens). Full steps in `DEPLOY.md`.
