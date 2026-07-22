# FitLog

A phone-first Progressive Web App for tracking nutrition, cardio, strength, and body weight — a personal, modern take on the classic MyFitnessPal, built end-to-end with React 19, TypeScript, and Supabase.

**Live app:** [fitlog-9wl.pages.dev](https://fitlog-9wl.pages.dev)

<!-- Add a screenshot or two here — a phone-sized capture of the Diary and Progress views goes a long way. -->

## Overview

FitLog is a single-user, cloud-synced fitness tracker designed mobile-first and installable as a PWA. It covers the full daily loop: logging food against calorie and macro goals, importing whole-food nutrition data from the USDA database, tracking cardio and strength workouts, and charting body-weight and lifting progress over time. The entire stack — data model, business logic, UI, tests, and CI/CD — was designed and built from scratch.

## Features

- **Food diary** with calorie, macro, and full micronutrient tracking (31 nutrients with %DV), plus a live logging streak.
- **USDA food import** — search and import whole-food nutrition data, with automatic per-serving rescaling from the source's per-100g values.
- **Recipes** — build multi-ingredient recipes whose per-serving nutrition is computed and stored automatically.
- **Cardio tracking** — MET-based or distance-based calorie estimates (walk/run/hike) with a manual override, and optional "eat-back" of burned calories.
- **Strength training** — workouts, exercises, and sets with supersets, estimated 1RM (Epley), and per-exercise progression charts (max weight, total volume, average weight per session).
- **Body measurements** — weight plus optional body metrics, with moving-average trend charts.
- **Smart calorie goals** — a hybrid Mifflin-St Jeor BMR × activity model with a deficit derived from a target weekly rate, or a manual override.
- **Installable PWA** with offline read access to recent data.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript |
| Styling | Tailwind CSS v4, small `cva`-based UI primitives (shadcn-style, no CLI) |
| Routing & data | React Router (lazy routes), TanStack Query |
| Backend | Supabase — Postgres + Auth (email/password, magic-link fallback) |
| Charts | Hand-rolled SVG (line charts + macro donut) — no charting library |
| Icons / PWA | lucide-react, vite-plugin-pwa |
| Hosting / CI | Cloudflare Pages (auto-deploy from `main`) |

## Architecture Highlights

- **Row-Level Security everywhere.** Every table is RLS owner-only, with `user_id` defaulting to `auth.uid()` — access control is enforced in the database, not just the client.
- **Snapshotting for historical accuracy.** Diary entries snapshot a food's nutrition at log time, so editing a food later never rewrites past days.
- **Feature-based data layer.** TanStack Query hooks are organized per feature with a consistent query-key scheme, and mutations invalidate exactly the keys they affect.
- **Pure, testable core logic.** Calorie/macro math, 1RM, MET calories, BMI, and progression live in dependency-free `src/lib` modules, unit-tested in isolation.
- **Hand-rolled SVG charts** keep the bundle lean and give full control over the mobile-first visualizations.

## Testing

Core business logic is covered by [Vitest](https://vitest.dev) unit tests, co-located with the pure-logic libraries (`calc`, `nutrients`, `progression`, `date`). These run without a backend or DOM, so the math that drives goals, macros, and progression is verified independently of the UI.

```bash
npm test          # run the unit suite once
npm run test:watch  # watch mode while iterating
```

A `tsc + vite` build check is run before every commit to keep the tree type-safe.

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (Postgres + Auth)
- A [USDA FoodData Central](https://fdc.nal.usda.gov/api-key-signup.html) API key (for food import)

### Setup

```bash
# 1. Clone and install
git clone https://github.com/kakaul94-prof/FitLog.git
cd FitLog
npm install

# 2. Configure environment (create a .env file)
cp .env.example .env   # then fill in the values below
```

```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_USDA_API_KEY=your-usda-api-key
```

```bash
# 3. Apply the database schema
#    Run supabase/schema.sql in the Supabase SQL Editor (it's idempotent)

# 4. Run it
npm run dev       # http://localhost:5173
```

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check and build for production (`tsc` + `vite`) |
| `npm test` | Run the unit test suite |
| `npm run test:watch` | Run tests in watch mode |

## Deployment

FitLog deploys to **Cloudflare Pages** from the GitHub repo: build with `npm run build`, publish the `dist` directory, and set the three environment variables in the Pages project. Pushing to `main` triggers an automatic redeploy. SPA deep links are handled via `public/_redirects`.

## Project Structure

```
src/
├── pages/         # one component per route
├── features/      # TanStack Query hooks, grouped by domain area
├── lib/           # pure logic: calc, nutrients, progression, date, supabase client
├── components/    # UI primitives + layout (AppLayout, BottomNav, shared panels)
└── data/          # built-in activities & exercises
supabase/
└── schema.sql     # idempotent schema + RLS policies
```

## Notes

FitLog is a personal project, built and maintained solo. The Supabase anon key is safe to expose in the client because access is fully governed by Row-Level Security policies.
