// Pure GPS distance math for the walk recorder — no Capacitor/DOM imports, so
// it's unit-tested (geo.test.ts). The platform watch wrapper is in geoWatch.ts.

export interface GeoFix {
  lat: number
  lng: number
  /** Horizontal accuracy radius in metres (smaller = better). */
  accuracy: number
  /** Epoch milliseconds. */
  t: number
}

export const METERS_PER_MILE = 1609.34

/** Great-circle distance between two fixes, in metres (haversine). */
export function haversineMeters(a: GeoFix, b: GeoFix): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export const metersToMiles = (m: number) => m / METERS_PER_MILE

/** Accumulated track state (immutably updated by addFix). */
export interface TrackState {
  /** Accepted distance in metres. */
  meters: number
  /** Milliseconds spent actually moving (excludes standing still). */
  movingMs: number
  /** Last accepted fix, or null before the first good one. */
  last: GeoFix | null
}

export const newTrack = (): TrackState => ({
  meters: 0,
  movingMs: 0,
  last: null,
})

export interface TrackTuning {
  /** Reject fixes with a worse (larger) accuracy radius, in metres. */
  maxAccuracyM: number
  /** Ignore hops smaller than this (GPS jitter around a point), in metres. */
  minStepM: number
  /** Reject implausible jumps faster than this, in metres/second. */
  maxSpeedMps: number
  /** A hop this fast or faster counts as "moving" (for pace), in m/s. */
  movingMps: number
}

export const DEFAULT_TUNING: TrackTuning = {
  maxAccuracyM: 25,
  minStepM: 4,
  maxSpeedMps: 12, // ~27 mph — above any run, so treat as a GPS teleport
  movingMps: 0.5, // ~1.1 mph — below a real walk, so standing still doesn't count
}

/**
 * Fold one fix into the track (pure). Drops low-accuracy fixes and teleport
 * jumps, ignores sub-step jitter so a stationary phone doesn't accrue distance,
 * and counts moving time only while actually moving. Rejected fixes keep the
 * last good fix so distance is measured from a trustworthy anchor.
 */
export function addFix(
  s: TrackState,
  fix: GeoFix,
  tune: TrackTuning = DEFAULT_TUNING,
): TrackState {
  // `!(<=)` also rejects a NaN/undefined accuracy.
  if (!(fix.accuracy <= tune.maxAccuracyM)) return s
  if (!s.last) return { ...s, last: fix }
  const dt = fix.t - s.last.t
  if (dt <= 0) return s
  const d = haversineMeters(s.last, fix)
  const speed = d / (dt / 1000)
  if (speed > tune.maxSpeedMps) return s // teleport — keep the last good fix
  if (d < tune.minStepM) return s // jitter — wait for real movement
  return {
    meters: s.meters + d,
    movingMs: s.movingMs + (speed >= tune.movingMps ? dt : 0),
    last: fix,
  }
}

/** Average moving speed in mph from accumulated metres + moving milliseconds. */
export function movingMph(meters: number, movingMs: number): number {
  if (movingMs <= 0) return 0
  const miles = meters / METERS_PER_MILE
  const hours = movingMs / 3_600_000
  return miles / hours
}

/** Pace in seconds per mile from the moving speed (0 if not moving). */
export function paceSecPerMile(meters: number, movingMs: number): number {
  const mph = movingMph(meters, movingMs)
  return mph > 0 ? 3600 / mph : 0
}
