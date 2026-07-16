import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, MapPin, Play, Square } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ACTIVITIES } from '@/data/activities'
import { useLatestWeight } from '@/features/measurements/useMeasurements'
import {
  startGeoWatch,
  openLocationSettings,
  canBackgroundGeo,
  type GeoWatcher,
} from '@/lib/geoWatch'
import {
  newTrack,
  addFix,
  metersToMiles,
  paceSecPerMile,
  type TrackState,
} from '@/lib/geo'
import { paceAwareCalories } from '@/lib/calc'
import { todayISO } from '@/lib/date'

const DIST_ACTS = ACTIVITIES.filter((a) => a.distanceBased)
const DEFAULT_ACT = 'walking_brisk'

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

function fmtPace(sec: number): string {
  if (!sec || !isFinite(sec)) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}′${String(s).padStart(2, '0')}″`
}

export function ExerciseTrackPage() {
  const nav = useNavigate()
  const { data: weight } = useLatestWeight()
  const w = weight ?? null

  const [phase, setPhase] = useState<'idle' | 'recording'>('idle')
  const [actKey, setActKey] = useState(DEFAULT_ACT)
  const [meters, setMeters] = useState(0)
  const [movingMs, setMovingMs] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  const trackRef = useRef<TrackState>(newTrack())
  const watcherRef = useRef<GeoWatcher | null>(null)
  const recordingRef = useRef(false)
  const startRef = useRef(0)
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null)

  const activity = DIST_ACTS.find((a) => a.key === actKey) ?? DIST_ACTS[0]

  const requestWakeLock = () => {
    // Best-effort: keeps the screen on for the browser/foreground fallback. The
    // native foreground service doesn't need it. Not supported everywhere.
    const wl = (
      navigator as unknown as {
        wakeLock?: {
          request: (t: string) => Promise<{ release: () => Promise<void> }>
        }
      }
    ).wakeLock
    if (!wl) return
    wl.request('screen')
      .then((s) => (wakeRef.current = s))
      .catch(() => {})
  }
  const releaseWakeLock = () => {
    wakeRef.current?.release().catch(() => {})
    wakeRef.current = null
  }

  const teardown = () => {
    recordingRef.current = false
    watcherRef.current?.stop()
    watcherRef.current = null
    releaseWakeLock()
  }

  // Live clock while recording.
  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 500)
    return () => clearInterval(id)
  }, [phase])

  // Stop the watcher if the page unmounts mid-recording.
  useEffect(() => () => teardown(), [])

  const start = async () => {
    setErr(null)
    trackRef.current = newTrack()
    setMeters(0)
    setMovingMs(0)
    setElapsedMs(0)
    startRef.current = Date.now()
    recordingRef.current = true
    setPhase('recording')
    requestWakeLock()
    try {
      const watcher = await startGeoWatch({
        onFix: (fix) => {
          const next = addFix(trackRef.current, fix)
          trackRef.current = next
          setMeters(next.meters)
          setMovingMs(next.movingMs)
        },
        onError: (msg) => setErr(msg),
      })
      // The user may have already backed out while permissions were prompting.
      if (recordingRef.current) watcherRef.current = watcher
      else watcher.stop()
    } catch {
      setErr('Could not start GPS.')
    }
  }

  const stopAndReview = () => {
    teardown()
    const distanceMi = metersToMiles(trackRef.current.meters)
    const durationMin = Math.max(
      0,
      Math.round((Date.now() - startRef.current) / 60000),
    )
    const movingMin = trackRef.current.movingMs / 60000
    const kcal = w ? paceAwareCalories(distanceMi, movingMin, w) : 0

    const p = new URLSearchParams()
    p.set('name', activity.name)
    p.set('met', String(activity.met))
    p.set('distanceBased', '1')
    if (distanceMi >= 0.01) p.set('dist', distanceMi.toFixed(2))
    if (durationMin > 0) p.set('dur', String(durationMin))
    if (kcal > 0) p.set('kcal', String(kcal))
    p.set('date', todayISO())
    // replace: the recorder shouldn't sit in the back stack behind the review.
    nav(`/exercise/add?${p.toString()}`, { replace: true })
  }

  const discard = () => {
    if (phase === 'recording' && !confirm('Discard this walk?')) return
    teardown()
    nav(-1)
  }

  const distanceMi = metersToMiles(meters)

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title={phase === 'recording' ? 'Recording' : 'Record a walk'}
        left={
          <Button variant="ghost" size="icon" onClick={discard}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />

      <div className="space-y-4 p-4">
        {phase === 'idle' ? (
          <>
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="act">Activity</Label>
                  <Select
                    id="act"
                    value={actKey}
                    onChange={(e) => setActKey(e.target.value)}
                  >
                    {DIST_ACTS.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-start gap-2 rounded-lg bg-primary/10 p-3 text-sm text-foreground">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    Uses GPS to measure your distance. Calories scale to your
                    actual pace. You can edit everything before saving.
                  </span>
                </div>
                {!canBackgroundGeo() && (
                  <p className="text-xs text-muted-foreground">
                    Screen-off recording needs the installed app. In a browser
                    this tracks only while the screen stays on.
                  </p>
                )}
              </CardContent>
            </Card>

            {w == null && (
              <p className="text-xs text-warning">
                Log your weight in Profile so the burn can be estimated.
              </p>
            )}

            <Button className="w-full" size="lg" onClick={start}>
              <Play className="mr-2 h-5 w-5" />
              Start
            </Button>
          </>
        ) : (
          <>
            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                  </span>
                  {activity.name} · Recording
                </div>

                <div className="flex items-baseline justify-center gap-2">
                  <span className="text-6xl font-bold tabular-nums tracking-tight">
                    {distanceMi.toFixed(2)}
                  </span>
                  <span className="text-lg font-semibold text-muted-foreground">
                    mi
                  </span>
                </div>

                <div className="flex items-stretch">
                  <div className="flex-1 text-center">
                    <div className="text-xl font-semibold tabular-nums">
                      {fmtClock(elapsedMs)}
                    </div>
                    <div className="text-xs text-muted-foreground">Time</div>
                  </div>
                  <div className="w-px bg-border" />
                  <div className="flex-1 text-center">
                    <div className="text-xl font-semibold tabular-nums">
                      {fmtPace(paceSecPerMile(meters, movingMs))}
                    </div>
                    <div className="text-xs text-muted-foreground">Pace /mi</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {err && (
              <Card className="border-destructive/40">
                <CardContent className="space-y-3 p-4">
                  <p className="text-sm text-destructive">{err}</p>
                  {canBackgroundGeo() && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => void openLocationSettings()}
                    >
                      Open location settings
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            <Button
              className="w-full"
              size="lg"
              variant="destructive"
              onClick={stopAndReview}
            >
              <Square className="mr-2 h-5 w-5" />
              Stop &amp; review
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
