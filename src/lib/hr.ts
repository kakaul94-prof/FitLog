import { zoneForHr, lbToKg } from '@/lib/calc'
import type { HrSamples } from '@/lib/database.types'

export type { HrSamples }

/**
 * Heart-rate strap logic: the BLE wire format, the per-second sample track a
 * recording builds up, and the summary (avg/max/time-in-zone) that gets stored
 * on the exercise entry. Pure functions only — the radio lives in `hrWatch.ts`.
 */

// ---------- BLE wire format ----------

export interface HrMeasurement {
  bpm: number
  /** R-R intervals in ms (only some straps send these; Coospo does). */
  rr: number[]
  /** Strap contact: true/false when the sensor reports it, null when it doesn't. */
  contact: boolean | null
}

/**
 * Parse a Heart Rate Measurement (characteristic 0x2A37) notification.
 * Byte 0 is a flags bitfield: bit0 = 16-bit HR value, bits1–2 = sensor contact
 * (0b11 = detected, 0b10 = not), bit3 = energy field present, bit4 = R-R list.
 * Everything is little-endian. Returns null on a truncated packet.
 */
export function parseHrMeasurement(view: DataView): HrMeasurement | null {
  if (view.byteLength < 2) return null
  const flags = view.getUint8(0)
  const wide = (flags & 0x01) !== 0
  if (wide && view.byteLength < 3) return null

  const bpm = wide ? view.getUint16(1, true) : view.getUint8(1)
  let i = wide ? 3 : 2

  const contactBits = flags & 0x06
  const contact = contactBits === 0 ? null : contactBits === 0x06

  if (flags & 0x08) i += 2 // energy expended, unused
  const rr: number[] = []
  if (flags & 0x10)
    for (; i + 1 < view.byteLength; i += 2)
      rr.push(Math.round((view.getUint16(i, true) / 1024) * 1000))

  return { bpm, rr, contact }
}

// ---------- the recording track ----------

/** Seconds of silence we'll carry the last reading across before giving up. A
 * strap drops the odd packet; a longer gap means it fell off or disconnected,
 * and inventing beats there would inflate the average. */
const MAX_FILL_S = 15

/** One bpm per elapsed second of a session; 0 = no reading for that second. */
export interface HrTrack {
  bpm: number[]
  /** Index of the last second that got a real reading, or -1. */
  lastIdx: number
}

export function newHrTrack(): HrTrack {
  return { bpm: [], lastIdx: -1 }
}

/**
 * Record a reading at `activeSec` (seconds of *unpaused* elapsed time, so a
 * pause simply doesn't advance the index). Gaps shorter than MAX_FILL_S are
 * sample-and-held from the previous reading; longer ones stay 0.
 * Mutates and returns the same track — this runs ~1×/second for an hour.
 */
export function addHrSample(
  track: HrTrack,
  bpm: number,
  activeSec: number,
): HrTrack {
  const i = Math.max(0, Math.floor(activeSec))
  if (!bpm || bpm <= 0 || i < track.lastIdx) return track
  const prev = track.lastIdx >= 0 ? track.bpm[track.lastIdx] : 0
  for (let j = track.lastIdx + 1; j < i; j++)
    track.bpm[j] = prev && j - track.lastIdx <= MAX_FILL_S ? prev : 0
  track.bpm[i] = bpm
  track.lastIdx = i
  return track
}

// ---------- summary ----------

export interface HrSummary {
  avg: number | null
  max: number | null
  min: number | null
  /** Seconds spent in zones 1–5 (index 0 = zone 1). Below zone 1 is dropped. */
  zoneSeconds: number[]
  /** Seconds carrying a real reading. */
  seconds: number
}

/**
 * Average / peak / time-in-zone over a per-second bpm array. Zone seconds need
 * a max HR; without one they come back all-zero but avg and max still work.
 */
export function summarizeHr(
  bpm: number[],
  maxHr: number | null,
  restingHr: number | null = null,
): HrSummary {
  const zoneSeconds = [0, 0, 0, 0, 0]
  let sum = 0
  let n = 0
  let max = 0
  let min = Infinity
  for (const b of bpm) {
    if (!b || b <= 0) continue
    sum += b
    n++
    if (b > max) max = b
    if (b < min) min = b
    if (maxHr != null) {
      const z = zoneForHr(b, maxHr, restingHr)
      if (z != null) zoneSeconds[z - 1]++
    }
  }
  return {
    avg: n ? Math.round(sum / n) : null,
    max: n ? max : null,
    min: n ? min : null,
    zoneSeconds,
    seconds: n,
  }
}

/** The zone you spent the most time in — what the entry's single `zone` becomes. */
export function dominantZone(zoneSeconds: number[]): number | null {
  let best = -1
  let bestI = -1
  zoneSeconds.forEach((s, i) => {
    if (s > best) {
      best = s
      bestI = i
    }
  })
  return best > 0 ? bestI + 1 : null
}

// ---------- storage shape ----------

/** How coarsely the curve is stored: an hour of riding fits in ~720 numbers.
 * The shape itself is HrSamples in database.types.ts. */
export const HR_SAMPLE_INTERVAL_S = 5

/** Bucket a per-second array down to one mean value per `intervalS`. */
export function downsampleBpm(
  bpm: number[],
  intervalS: number = HR_SAMPLE_INTERVAL_S,
): number[] {
  const step = Math.max(1, Math.floor(intervalS))
  const out: number[] = []
  for (let i = 0; i < bpm.length; i += step) {
    let sum = 0
    let n = 0
    for (let j = i; j < Math.min(i + step, bpm.length); j++) {
      if (bpm[j] > 0) {
        sum += bpm[j]
        n++
      }
    }
    out.push(n ? Math.round(sum / n) : 0)
  }
  return out
}

/** True when a stored curve actually has something to draw. */
export function hasHrCurve(s: HrSamples | null | undefined): boolean {
  return !!s?.bpm?.some((b) => b > 0)
}

// ---------- energy ----------

/**
 * Keytel HR-based burn — kcal from average heart rate, weight, age and sex.
 * Meaningfully better than a MET guess for machine work, where the MET table
 * can't see how hard you're actually pushing. Null when an input is missing;
 * the formula also goes negative at rest, which clamps to 0.
 */
export function hrCalories(
  avgHr: number | null,
  durationMin: number | null,
  weightLb: number | null,
  age: number | null,
  sex: 'male' | 'female' | null,
): number | null {
  if (!avgHr || !durationMin || !weightLb || !age || !sex) return null
  const kg = lbToKg(weightLb)
  const perMin =
    sex === 'female'
      ? (-20.4022 + 0.4472 * avgHr - 0.1263 * kg + 0.074 * age) / 4.184
      : (-55.0969 + 0.6309 * avgHr + 0.1988 * kg + 0.2017 * age) / 4.184
  return Math.max(0, Math.round(perMin * durationMin))
}
