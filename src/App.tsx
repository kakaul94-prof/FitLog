import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/lib/auth'
import { AppLayout } from '@/components/layout/AppLayout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LoginPage } from '@/pages/LoginPage'
import { watchSystemTheme } from '@/lib/theme'

const lazyPage = <T extends Record<string, React.ComponentType>>(
  loader: () => Promise<T>,
  name: keyof T,
) => lazy(() => loader().then((m) => ({ default: m[name] })))

const DiaryPage = lazyPage(() => import('@/pages/DiaryPage'), 'DiaryPage')
const StrengthPage = lazyPage(() => import('@/pages/StrengthPage'), 'StrengthPage')
const ProgressPage = lazyPage(() => import('@/pages/ProgressPage'), 'ProgressPage')
const MorePage = lazyPage(() => import('@/pages/MorePage'), 'MorePage')
const ProfilePage = lazyPage(() => import('@/pages/ProfilePage'), 'ProfilePage')
const FoodsPage = lazyPage(() => import('@/pages/FoodsPage'), 'FoodsPage')
const FoodFormPage = lazyPage(() => import('@/pages/FoodFormPage'), 'FoodFormPage')
const FoodPickerPage = lazyPage(() => import('@/pages/FoodPickerPage'), 'FoodPickerPage')
const DiaryEntryPage = lazyPage(() => import('@/pages/DiaryEntryPage'), 'DiaryEntryPage')
const DiaryNutrientsPage = lazyPage(() => import('@/pages/DiaryNutrientsPage'), 'DiaryNutrientsPage')
const ExerciseAddPage = lazyPage(() => import('@/pages/ExerciseAddPage'), 'ExerciseAddPage')
const WorkoutPage = lazyPage(() => import('@/pages/WorkoutPage'), 'WorkoutPage')
const ExercisePickerPage = lazyPage(() => import('@/pages/ExercisePickerPage'), 'ExercisePickerPage')
const ExerciseDetailPage = lazyPage(() => import('@/pages/ExerciseDetailPage'), 'ExerciseDetailPage')
const WorkoutCalendarPage = lazyPage(() => import('@/pages/WorkoutCalendarPage'), 'WorkoutCalendarPage')
const RoutineEditPage = lazyPage(() => import('@/pages/RoutineEditPage'), 'RoutineEditPage')
const RecipesPage = lazyPage(() => import('@/pages/RecipesPage'), 'RecipesPage')
const RecipeEditPage = lazyPage(() => import('@/pages/RecipeEditPage'), 'RecipeEditPage')

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
})

function Spinner() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  )
}

function Routed() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<DiaryPage />} />
              <Route path="strength" element={<StrengthPage />} />
              <Route path="progress" element={<ProgressPage />} />
              <Route path="more" element={<MorePage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="foods" element={<FoodsPage />} />
              <Route path="foods/new" element={<FoodFormPage />} />
              <Route path="foods/:id" element={<FoodFormPage />} />
              <Route path="recipes" element={<RecipesPage />} />
            </Route>
            <Route path="/diary/add" element={<FoodPickerPage />} />
            <Route path="/diary/entry/:id" element={<DiaryEntryPage />} />
            <Route path="/diary/nutrients" element={<DiaryNutrientsPage />} />
            <Route path="/exercise/add" element={<ExerciseAddPage />} />
            <Route path="/exercise/edit/:id" element={<ExerciseAddPage />} />
            <Route path="/workout/:id" element={<WorkoutPage />} />
            <Route path="/workout/:id/add-exercise" element={<ExercisePickerPage />} />
            <Route path="/lift/exercise/:key" element={<ExerciseDetailPage />} />
            <Route path="/lift/calendar" element={<WorkoutCalendarPage />} />
            <Route path="/routines/:id" element={<RoutineEditPage />} />
            <Route path="/recipes/:id" element={<RecipeEditPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

function Gate() {
  const { session, loading } = useAuth()
  if (loading) return <Spinner />
  return session ? <Routed /> : <LoginPage />
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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
