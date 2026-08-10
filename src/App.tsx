import { lazy, Suspense, useEffect } from 'react'
import {
  createBrowserRouter,
  createRoutesFromElements,
  RouterProvider,
  Route,
  Outlet,
} from 'react-router-dom'
import { QueryClient } from '@tanstack/react-query'
import {
  PersistQueryClientProvider,
  type PersistedClient,
  type Persister,
} from '@tanstack/react-query-persist-client'
import { get, set, del } from 'idb-keyval'
import { setupOnlineManager } from '@/lib/network'
import { setupAuthRefresh } from '@/lib/authRefresh'
import { initReminders } from '@/lib/reminders'
import { registerDiaryMutationDefaults } from '@/features/diary/useDiary'
import { useWeightSyncOnAppOpen } from '@/features/measurements/useWeightSync'
import { OfflineIndicator } from '@/components/OfflineIndicator'
import { AuthProvider, useAuth } from '@/lib/auth'
import { LockGate } from '@/components/LockGate'
import { AppLayout } from '@/components/layout/AppLayout'
import { ErrorBoundary, RouteErrorElement } from '@/components/ErrorBoundary'
import { LoginPage } from '@/pages/LoginPage'
import { watchSystemTheme } from '@/lib/theme'
import { RestTimerProvider } from '@/components/strength/RestTimerProvider'
import { RestTimerBar } from '@/components/strength/RestTimerBar'

const lazyPage = <T extends Record<string, React.ComponentType>>(
  loader: () => Promise<T>,
  name: keyof T,
) => lazy(() => loader().then((m) => ({ default: m[name] })))

const DiaryPage = lazyPage(() => import('@/pages/DiaryPage'), 'DiaryPage')
const StrengthPage = lazyPage(() => import('@/pages/StrengthPage'), 'StrengthPage')
const ProgressPage = lazyPage(() => import('@/pages/ProgressPage'), 'ProgressPage')
const MorePage = lazyPage(() => import('@/pages/MorePage'), 'MorePage')
const ProfilePage = lazyPage(() => import('@/pages/ProfilePage'), 'ProfilePage')
const PatchNotesPage = lazyPage(() => import('@/pages/PatchNotesPage'), 'PatchNotesPage')
const LibraryPage = lazyPage(() => import('@/pages/LibraryPage'), 'LibraryPage')
const FoodFormPage = lazyPage(() => import('@/pages/FoodFormPage'), 'FoodFormPage')
const FoodPickerPage = lazyPage(() => import('@/pages/FoodPickerPage'), 'FoodPickerPage')
const ScanMealPage = lazyPage(() => import('@/pages/ScanMealPage'), 'ScanMealPage')
const UsdaSearchPage = lazyPage(() => import('@/pages/UsdaSearchPage'), 'UsdaSearchPage')
const DiaryEntryPage = lazyPage(() => import('@/pages/DiaryEntryPage'), 'DiaryEntryPage')
const DiaryNutrientsPage = lazyPage(() => import('@/pages/DiaryNutrientsPage'), 'DiaryNutrientsPage')
const ExerciseAddPage = lazyPage(() => import('@/pages/ExerciseAddPage'), 'ExerciseAddPage')
const ExerciseTrackPage = lazyPage(() => import('@/pages/ExerciseTrackPage'), 'ExerciseTrackPage')
const WorkoutPage = lazyPage(() => import('@/pages/WorkoutPage'), 'WorkoutPage')
const ExercisePickerPage = lazyPage(() => import('@/pages/ExercisePickerPage'), 'ExercisePickerPage')
const ExerciseDetailPage = lazyPage(() => import('@/pages/ExerciseDetailPage'), 'ExerciseDetailPage')
const WorkoutCalendarPage = lazyPage(() => import('@/pages/WorkoutCalendarPage'), 'WorkoutCalendarPage')
const MuscleVolumePage = lazyPage(() => import('@/pages/MuscleVolumePage'), 'MuscleVolumePage')
const MuscleGoalsPage = lazyPage(() => import('@/pages/MuscleGoalsPage'), 'MuscleGoalsPage')
const GoalsOverviewPage = lazyPage(() => import('@/pages/GoalsOverviewPage'), 'GoalsOverviewPage')
const CustomExercisesPage = lazyPage(() => import('@/pages/CustomExercisesPage'), 'CustomExercisesPage')
const RoutineEditPage = lazyPage(() => import('@/pages/RoutineEditPage'), 'RoutineEditPage')
const TemplatesPage = lazyPage(() => import('@/pages/TemplatesPage'), 'TemplatesPage')
const WorkoutHistoryPage = lazyPage(() => import('@/pages/WorkoutHistoryPage'), 'WorkoutHistoryPage')
const TrainerPage = lazyPage(() => import('@/pages/TrainerPage'), 'TrainerPage')
const TrainerMemoryPage = lazyPage(() => import('@/pages/TrainerMemoryPage'), 'TrainerMemoryPage')
const ProgramPage = lazyPage(() => import('@/pages/ProgramPage'), 'ProgramPage')
const ProgramBrowsePage = lazyPage(() => import('@/pages/ProgramBrowsePage'), 'ProgramBrowsePage')
const ProgramPreviewPage = lazyPage(() => import('@/pages/ProgramPreviewPage'), 'ProgramPreviewPage')
const CardioGoalPage = lazyPage(() => import('@/pages/CardioGoalPage'), 'CardioGoalPage')
const RecipeEditPage = lazyPage(() => import('@/pages/RecipeEditPage'), 'RecipeEditPage')
const RemindersPage = lazyPage(() => import('@/pages/RemindersPage'), 'RemindersPage')

// Persisted query cache (Phase 1 offline reads): keep entries in memory long
// enough for the IndexedDB persister to restore them on reopen. gcTime must be
// >= the persister maxAge or restored queries are garbage-collected on mount.
const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 // 24h
const PERSIST_BUSTER = 'fitlog-cache-v2' // bump to drop the cache on a shape change

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: PERSIST_MAX_AGE,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// IndexedDB-backed persister (idb-keyval) — survives reload / app reopen, and
// unlike localStorage isn't ~5MB-capped as the foods library / history grow.
function createIDBPersister(key: IDBValidKey = 'fitlog-query-cache'): Persister {
  return {
    persistClient: (client: PersistedClient) => set(key, client),
    restoreClient: () => get<PersistedClient>(key),
    removeClient: () => del(key),
  }
}
const persister = createIDBPersister()

// Wire TanStack Query's online state to Capacitor Network so writes pause while
// offline and resume on reconnect (Phase 2). Safe everywhere — the plugin's web
// impl covers the browser PWA; the native plugin lands with the next APK build.
setupOnlineManager()

// Keep the Supabase session refreshing across app backgrounding on native, so a
// reopen doesn't bounce to the login screen with an expired token (no-op on web).
setupAuthRefresh()

// Register diary mutations as keyed defaults so writes that were paused offline
// and persisted can be resumed after an app restart (kill-resilience for the
// offline queue). Must run before render so a restored mutation finds its fn.
registerDiaryMutationDefaults(queryClient)

function Spinner() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  )
}

// Root layout: a single Suspense boundary for the lazy routes (data-router
// form). The errorElement catches lazy-chunk load failures so the chunk-reload
// recovery still runs (see RouteErrorElement).
function RootLayout() {
  return (
    <Suspense fallback={<Spinner />}>
      <Outlet />
    </Suspense>
  )
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<RootLayout />} errorElement={<RouteErrorElement />}>
      <Route element={<AppLayout />}>
        <Route index element={<DiaryPage />} />
        <Route path="strength" element={<StrengthPage />} />
        <Route path="progress" element={<ProgressPage />} />
        <Route path="more" element={<MorePage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="patch-notes" element={<PatchNotesPage />} />
        <Route path="foods" element={<LibraryPage />} />
        <Route path="foods/new" element={<FoodFormPage />} />
        <Route path="foods/:id" element={<FoodFormPage />} />
        <Route path="recipes" element={<LibraryPage />} />
        <Route path="meals" element={<LibraryPage />} />
      </Route>
      <Route path="/diary/add" element={<FoodPickerPage />} />
      <Route path="/diary/scan" element={<ScanMealPage />} />
      <Route path="/foods/usda" element={<UsdaSearchPage />} />
      <Route path="/diary/entry/:id" element={<DiaryEntryPage />} />
      <Route path="/diary/nutrients" element={<DiaryNutrientsPage />} />
      <Route path="/exercise/add" element={<ExerciseAddPage />} />
      <Route path="/exercise/track" element={<ExerciseTrackPage />} />
      <Route path="/exercise/edit/:id" element={<ExerciseAddPage />} />
      <Route path="/workout/:id" element={<WorkoutPage />} />
      <Route path="/workout/:id/add-exercise" element={<ExercisePickerPage />} />
      <Route path="/lift/exercise/:key" element={<ExerciseDetailPage />} />
      <Route path="/lift/calendar" element={<WorkoutCalendarPage />} />
      <Route path="/lift/volume" element={<MuscleVolumePage />} />
      <Route path="/lift/volume/goals" element={<MuscleGoalsPage />} />
      <Route path="/lift/goals" element={<GoalsOverviewPage />} />
      <Route path="/lift/custom-exercises" element={<CustomExercisesPage />} />
      <Route path="/lift/templates" element={<TemplatesPage />} />
      <Route path="/lift/history" element={<WorkoutHistoryPage />} />
      <Route path="/lift/trainer" element={<TrainerPage />} />
      <Route path="/lift/trainer/memory" element={<TrainerMemoryPage />} />
      <Route path="/program" element={<ProgramPage />} />
      <Route path="/program/browse" element={<ProgramBrowsePage />} />
      <Route path="/program/browse/:presetId" element={<ProgramPreviewPage />} />
      <Route path="/cardio/goal" element={<CardioGoalPage />} />
      <Route path="/routines/:id" element={<RoutineEditPage />} />
      <Route path="/recipes/:id" element={<RecipeEditPage />} />
      <Route path="/reminders" element={<RemindersPage />} />
    </Route>,
  ),
)

// Meal/streak reminder notifications (Android app only): create the channel,
// re-arm the alarms from saved settings, and deep-link notification taps.
initReminders((path) => void router.navigate(path))

function Routed() {
  // Import new Health Connect weigh-ins on open/resume (no-op on web/no grant).
  useWeightSyncOnAppOpen()
  return (
    <ErrorBoundary>
      <RestTimerProvider>
        <RouterProvider router={router} />
        <RestTimerBar />
        <OfflineIndicator />
      </RestTimerProvider>
    </ErrorBoundary>
  )
}

function Gate() {
  const { session, loading } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <LoginPage />
  return (
    <LockGate>
      <Routed />
    </LockGate>
  )
}

function App() {
  // Once the app has rendered stably, clear the one-shot chunk-reload guard so a
  // future deploy can auto-recover again (see ErrorBoundary).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        sessionStorage.removeItem('fitlog:chunk-reload')
      } catch {
        /* ignore */
      }
    }, 5000)
    return () => clearTimeout(t)
  }, [])

  // Keep the theme in sync with the OS preference while 'system' is selected.
  useEffect(() => watchSystemTheme(), [])

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: PERSIST_MAX_AGE, buster: PERSIST_BUSTER }}
      onSuccess={() => {
        // After the cache restores, fire any writes that were paused offline in
        // a previous session (they also auto-resume on reconnect).
        void queryClient.resumePausedMutations()
      }}
    >
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </PersistQueryClientProvider>
  )
}

export default App
