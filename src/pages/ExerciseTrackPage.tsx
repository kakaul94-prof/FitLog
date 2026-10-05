import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ChevronLeft,
  HeartPulse,
  MapPin,
  Pause,
  Play,
  Square,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ACTIVITIES, RECORDER_ACTIVITIES } from '@/data/activities'
import { useLatestWeight } from '@/features/measurements/useMeasurements'
import { useProfile } from '@/features/profile/useProfile'
import { useHrMonitor } from '@/features/hr/useHrMonitor'
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
import {
  paceAwareCalories,
  resolveHrZones,
  resolveMaxHr,
  resolveZoneForHr,
} from '@/lib/calc'
import {
  addHrSample,
  dominantZone,
  downsampleBpm,
  newHrTrack,
  summarizeHr,
  HR_SAMPLE_INTERVAL_S,
} from '@/lib/hr'
import { stashHrSession } from '@/lib/hrHandoff'
import {
  connectHr,
  disconnectHr,
  hrAutoConnect,
  hrSupported,
  pairHrMonitor,
  savedHrDevice,
} from '@/lib/hrWatch'
import { zoneColor } from '@/data/zones'
import { todayISO } from '@/lib/date'
import { cn } from '@/lib/utils'

const DIST_ACTS = RECORDER_ACTIVITIES
const ALL_ACTS = [...ACTIVITIES].sort((a, b) => a.name.localeCompare(b.name))
const DEFAULT_ACT = 'walking'

/** GPS measures a route; HR-only is a stopwatch for machines and classes, where
 * the strap is the only thing worth measuring. */
type Mode = 'gps' | 'hr'

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
  const { data: profile } = useProfile()
  const w = weight ?? null

  // ?activity=<key> preselects the activity (programmed cardio deep-links here).
  const [params] = useSearchParams()
  const requestedAct = params.get('activity')
  // A requested activity GPS can't measure (elliptical, rower) opens in HR mode
  // rather than silently falling back to walking.
  const requestedIsDist =
    !!requestedAct && DIST_ACTS.some((a) => a.key === requestedAct)
  const requestedIsAny =
    !!requestedAct && ALL_ACTS.some((a) => a.key === requestedAct)
  const [phase, setPhase] = useState<'idle' | 'recording' | 'paused'>('idle')
  const [mode, setMode] = useState<Mode>(
    requestedIsAny && !requestedIsDist ? 'hr' : 'gps',
  )
  const [actKey, setActKey] = useState(
    requestedIsAny ? requestedAct! : DEFAULT_ACT,
  )
  const [meters, setMeters] = useState(0)
  const [movingMs, setMovingMs] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  const hr = useHrMonitor()
  const [paired, setPaired] = useState(() => !!savedHrDevice())
  const hrTrackRef = useRef(newHrTrack())
  const hrStartRef = useRef(0)
  /** Whether this recording actually saw a beat — a paired-but-dead strap
   * shouldn't stamp an empty curve onto the entry. */
  const hrSeenRef = useRef(false)

  const trackRef = useRef<TrackState>(newTrack())
  const watcherRef = useRef<GeoWatcher | null>(null)
  const recordingRef = useRef(false)
  const startRef = useRef(0)
  /** Total milliseconds spent in finished pauses. */
  const pausedMsRef = useRef(0)
  /** Epoch ms the current pause began, or 0 when not paused. */
  const pausedAtRef = useRef(0)
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null)

  /**
   * Wall-clock since start minus every paused stretch, including one still in
   * progress — so the clock freezes while paused.
   */
  const activeMs = () => {
    const paused =
      pausedMsRef.current +
      (pausedAtRef.current ? Date.now() - pausedAtRef.current : 0)
    return Math.max(0, Date.now() - startRef.current - paused)
  }

  const acts = mode === 'gps' ? DIST_ACTS : ALL_ACTS
  const activity = acts.find((a) => a.key === actKey) ?? acts[0]

  const maxHr = resolveMaxHr(profile)
  const restingHr = profile?.resting_hr ?? null
  const zones = resolveHrZones(profile)
  const liveZone = hr.bpm ? resolveZoneForHr(hr.bpm, profile) : null
  const liveColor = liveZone != null ? zoneColor(liveZone) : undefined
  const hrSummary = summarizeHr(hrTrackRef.current.bpm, maxHr, restingHr)
  /** True once the strap has fed this recording at least one beat. */
  const hrLive = hr.status === 'connected' && hr.bpm != null && !hr.stale

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

  /** Set when this page opened the strap connection, so leaving here doesn't
   * hang up on a connection the settings screen was holding. */
  const hrOwnedRef = useRef(false)

  const teardown = () => {
    recordingRef.current = false
    watcherRef.current?.stop()
    watcherRef.current = null
    releaseWakeLock()
    if (hrOwnedRef.current) {
      hrOwnedRef.current = false
      void disconnectHr()
    }
  }

  // Live clock while recording. Paused ticks aren't scheduled at all, so the
  // last value written by pause() stays on screen.
  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => setElapsedMs(activeMs()), 500)
    return () => clearInterval(id)
  }, [phase])

  // Stop the watcher if the page unmounts mid-recording.
  useEffect(() => () => teardown(), [])

  /**
   * Bank each strap reading against the session clock. Keyed on `hr.at` so one
   * reading records once; paused seconds never advance activeMs(), so a pause
   * leaves no gap in the curve rather than a hole.
   */
  useEffect(() => {
    if (phase !== 'recording' || pausedAtRef.current) return
    if (!hr.bpm || !hr.at) return
    addHrSample(hrTrackRef.current, hr.bpm, activeMs() / 1000)
    hrSeenRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hr.at, phase])

  /** Reach for a paired strap. Never blocks the recording — a session that
   * starts without HR is still a session. */
  const attachStrap = async () => {
    if (!paired || !hrAutoConnect() || hr.status !== 'idle') return
    // Only "ours" to hang up on if we're the one who got it connected.
    hrOwnedRef.current = await connectHr()
  }

  const start = async () => {
    setErr(null)
    trackRef.current = newTrack()
    hrTrackRef.current = newHrTrack()
    hrSeenRef.current = false
    hrStartRef.current = Date.now()
    setMeters(0)
    setMovingMs(0)
    setElapsedMs(0)
    startRef.current = Date.now()
    pausedMsRef.current = 0
    pausedAtRef.current = 0
    recordingRef.current = true
    setPhase('recording')
    requestWakeLock()
    void attachStrap()
    // HR-only mode is a stopwatch — nothing to watch but the strap.
    if (mode === 'hr') return
    try {
      const watcher = await startGeoWatch({
        onFix: (fix) => {
          if (pausedAtRef.current) return // paused — no distance, no moving time
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

  /**
   * Pause. The GPS watcher keeps running (restarting it risks a re-prompt and a
   * slow re-acquire) but its fixes are dropped, and dropping the last fix means
   * the walk resumes from a fresh anchor — so wherever you go while paused, the
   * gap never lands in your distance.
   */
  const pause = () => {
    pausedAtRef.current = Date.now()
    setElapsedMs(activeMs())
    trackRef.current = { ...trackRef.current, last: null }
    setPhase('paused')
  }

  const resume = () => {
    if (pausedAtRef.current)
      pausedMsRef.current += Date.now() - pausedAtRef.current
    pausedAtRef.current = 0
    setPhase('recording')
  }

  const stopAndReview = () => {
    const durationMin = Math.max(0, Math.round(activeMs() / 60000))
    const gps = mode === 'gps'
    teardown()
    const distanceMi = gps ? metersToMiles(trackRef.current.meters) : 0
    const movingMin = trackRef.current.movingMs / 60000
    const kcal = gps && w ? paceAwareCalories(distanceMi, movingMin, w) : 0

    const p = new URLSearchParams()
    p.set('name', activity.name)
    p.set('met', String(activity.met))
    if (gps) {
      p.set('distanceBased', '1')
      if (distanceMi >= 0.01) p.set('dist', distanceMi.toFixed(2))
      if (kcal > 0) p.set('kcal', String(kcal))
    }
    if (durationMin > 0) p.set('dur', String(durationMin))
    p.set('date', todayISO())

    // Hand the curve over out-of-band — it's far too big for the query string.
    const s = summarizeHr(hrTrackRef.current.bpm, maxHr, restingHr)
    if (hrSeenRef.current && s.avg != null) {
      stashHrSession({
        samples: {
          start: new Date(hrStartRef.current).toISOString(),
          interval_s: HR_SAMPLE_INTERVAL_S,
          bpm: downsampleBpm(hrTrackRef.current.bpm),
        },
        avg: s.avg,
        max: s.max,
        zoneSeconds: s.zoneSeconds,
        zone: dominantZone(s.zoneSeconds),
      })
      p.set('hr', '1')
    }
    // replace: the recorder shouldn't sit in the back stack behind the review.
    nav(`/exercise/add?${p.toString()}`, { replace: true })
  }

  const discard = () => {
    if (phase !== 'idle' && !confirm('Discard this session?')) return
    teardown()
    nav(-1)
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    // Every GPS activity is in the full list, but not the reverse — coming back
    // to GPS from "Rowing machine" needs a valid selection again.
    if (m === 'gps' && !DIST_ACTS.some((a) => a.key === actKey))
      setActKey(DEFAULT_ACT)
  }

  const distanceMi = metersToMiles(meters)
  const paused = phase === 'paused'

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title={
          phase === 'idle'
            ? mode === 'gps'
              ? 'Record a walk/run'
              : 'Record a session'
            : paused
              ? 'Paused'
              : 'Recording'
        }
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
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { key: 'gps' as const, label: 'GPS route' },
                      { key: 'hr' as const, label: 'Heart rate' },
                    ] satisfies { key: Mode; label: string }[]
                  ).map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => switchMode(m.key)}
                      className={cn(
                        'rounded-lg border py-2 text-sm font-medium transition-colors',
                        mode === m.key
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-transparent bg-muted text-muted-foreground',
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="act">Activity</Label>
                  <Select
                    id="act"
                    value={actKey}
                    onChange={(e) => setActKey(e.target.value)}
                  >
                    {acts.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </div>
                {mode === 'gps' ? (
                  <div className="flex items-start gap-2 rounded-lg bg-primary/10 p-3 text-sm text-foreground">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>
                      Uses GPS to measure your distance. Calories scale to your
                      actual pace. You can edit everything before saving.
                    </span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg bg-primary/10 p-3 text-sm text-foreground">
                    <HeartPulse className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>
                      A stopwatch plus your strap — for machines and classes
                      where the effort matters and the distance doesn’t.
                    </span>
                  </div>
                )}
                {mode === 'gps' && !canBackgroundGeo() && (
                  <p className="text-xs text-muted-foreground">
                    Screen-off recording needs the installed app. In a browser
                    this tracks only while the screen stays on.
                  </p>
                )}
              </CardContent>
            </Card>

            {hrSupported() && (
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <HeartPulse
                    className={cn(
                      'h-5 w-5 shrink-0',
                      hrLive ? 'text-primary' : 'text-muted-foreground',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {paired ? hr.deviceName : 'No strap paired'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {hrLive
                        ? `${hr.bpm} bpm`
                        : paired
                          ? 'Connects when you start'
                          : 'Record heart rate, zones and a peak'}
                    </p>
                  </div>
                  {paired ? (
                    <Link
                      to="/heart-rate"
                      className="shrink-0 text-sm font-medium text-primary"
                    >
                      Manage
                    </Link>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void pairHrMonitor().then((ok) => ok && setPaired(true))
                      }
                    >
                      Pair
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

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
                <div
                  className={cn(
                    'flex items-center justify-center gap-2 text-sm',
                    paused ? 'text-warning' : 'text-muted-foreground',
                  )}
                >
                  <span className="relative flex h-2.5 w-2.5">
                    {!paused && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    )}
                    <span
                      className={cn(
                        'relative inline-flex h-2.5 w-2.5 rounded-full',
                        paused ? 'bg-warning' : 'bg-primary',
                      )}
                    />
                  </span>
                  {activity.name} · {paused ? 'Paused' : 'Recording'}
                </div>

                {(hr.status !== 'idle' || hrSeenRef.current) && (
                  <div
                    className="rounded-lg border p-3 text-center"
                    style={
                      liveColor
                        ? {
                            borderColor: liveColor,
                            background: `color-mix(in srgb, ${liveColor} 8%, transparent)`,
                          }
                        : undefined
                    }
                  >
                    <div className="flex items-baseline justify-center gap-2">
                      <HeartPulse
                        className={cn(
                          'h-5 w-5 self-center',
                          !hrLive && 'opacity-40',
                        )}
                        style={liveColor ? { color: liveColor } : undefined}
                      />
                      <span
                        className={cn(
                          'text-4xl font-bold tabular-nums leading-none',
                          !hrLive && 'opacity-40',
                        )}
                        style={liveColor ? { color: liveColor } : undefined}
                      >
                        {hr.bpm ?? '—'}
                      </span>
                      <span className="text-sm font-semibold text-muted-foreground">
                        bpm
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {hr.status === 'connecting'
                        ? 'Connecting to your strap…'
                        : hr.status === 'idle'
                          ? 'Strap disconnected'
                          : hr.stale
                            ? 'No signal — check the strap'
                            : liveZone != null && zones
                              ? `Zone ${liveZone} · ${zones[liveZone - 1].name}`
                              : 'Reading'}
                    </p>
                  </div>
                )}

                <div
                  className={cn(
                    'flex items-baseline justify-center gap-2',
                    paused && 'opacity-55',
                  )}
                >
                  {mode === 'gps' ? (
                    <>
                      <span className="text-6xl font-bold tabular-nums tracking-tight">
                        {distanceMi.toFixed(2)}
                      </span>
                      <span className="text-lg font-semibold text-muted-foreground">
                        mi
                      </span>
                    </>
                  ) : (
                    <span className="text-6xl font-bold tabular-nums tracking-tight">
                      {fmtClock(elapsedMs)}
                    </span>
                  )}
                </div>

                <div
                  className={cn('flex items-stretch', paused && 'opacity-55')}
                >
                  {mode === 'gps' ? (
                    <>
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
                        <div className="text-xs text-muted-foreground">
                          Pace /mi
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex-1 text-center">
                        <div className="text-xl font-semibold tabular-nums">
                          {hrSummary.avg ?? '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Avg HR
                        </div>
                      </div>
                      <div className="w-px bg-border" />
                      <div className="flex-1 text-center">
                        <div className="text-xl font-semibold tabular-nums">
                          {hrSummary.max ?? '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Max HR
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {mode === 'gps' && hrSummary.avg != null && (
                  <p className="text-center text-xs text-muted-foreground">
                    Avg {hrSummary.avg} · Max {hrSummary.max} bpm
                  </p>
                )}
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

            <div className="flex gap-3">
              {paused ? (
                <Button className="flex-1" size="lg" onClick={resume}>
                  <Play className="mr-2 h-5 w-5" />
                  Resume
                </Button>
              ) : (
                <Button
                  className="flex-1"
                  size="lg"
                  variant="outline"
                  onClick={pause}
                >
                  <Pause className="mr-2 h-5 w-5" />
                  Pause
                </Button>
              )}
              <Button
                className="flex-1"
                size="lg"
                variant="destructive"
                onClick={stopAndReview}
              >
                <Square className="mr-2 h-5 w-5" />
                Stop
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
