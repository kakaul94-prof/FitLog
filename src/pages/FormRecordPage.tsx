import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, RotateCcw, SwitchCamera, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MAX_CLIPS,
  useFormVideos,
  useUploadFormVideo,
} from '@/features/strength/useFormVideos'
import { ReplaceClipSheet } from '@/components/ReplaceClipSheet'

const MAX_SEC = 30
const BITRATE = 2_500_000 // ~9 MB per 30s at 720p
const COUNTDOWNS = [0, 3, 5, 10] as const
const COUNTDOWN_KEY = 'fitlog.recCountdown'

// First container the device can record. Chrome/WebView 126+ records H.264
// MP4 (seeks well, plays everywhere); older engines fall back to WebM.
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]
function pickMime(): string | undefined {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m))
}

function loadCountdown(): number {
  try {
    const n = Number(localStorage.getItem(COUNTDOWN_KEY))
    return (COUNTDOWNS as readonly number[]).includes(n) ? n : 5
  } catch {
    return 5
  }
}

type Phase = 'ready' | 'countdown' | 'recording' | 'review'
type Facing = 'environment' | 'user'
type WakeSentinel = { release: () => Promise<void> }

const canRecord =
  typeof window !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof window.MediaRecorder !== 'undefined'

export function FormRecordPage() {
  const { key } = useParams()
  const nav = useNavigate()
  const { data: clips = [] } = useFormVideos(key)
  const upload = useUploadFormVideo()
  const [replacing, setReplacing] = useState(false)

  const [phase, setPhase] = useState<Phase>('ready')
  const [facing, setFacing] = useState<Facing>('environment')
  const [countdown, setCountdown] = useState(loadCountdown)
  const [left, setLeft] = useState(0) // countdown seconds remaining
  const [elapsed, setElapsed] = useState(0)
  const [clip, setClip] = useState<{ file: File; url: string; sec: number } | null>(null)
  const [camError, setCamError] = useState<string | null>(
    canRecord ? null : "This device can't record in the app. Use Upload from gallery instead.",
  )

  const previewRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const startRef = useRef(0)

  const clearTimer = () => {
    if (timerRef.current != null) window.clearInterval(timerRef.current)
    timerRef.current = null
  }

  // Camera is live everywhere except review; released there so the camera
  // light goes off while you watch the take back.
  const needCamera = canRecord && phase !== 'review'
  useEffect(() => {
    if (!needCamera) return
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        streamRef.current = s
        setCamError(null)
        if (previewRef.current) previewRef.current.srcObject = s
      })
      .catch((e: DOMException) => {
        if (cancelled) return
        setCamError(
          e.name === 'NotAllowedError'
            ? "Camera access is blocked. Allow the camera for FitLog in your phone's settings, then try again."
            : `Couldn't start the camera (${e.name}).`,
        )
      })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [needCamera, facing])

  // Keep the screen awake while the phone is propped up on this page.
  useEffect(() => {
    let sentinel: WakeSentinel | null = null
    const wl = (navigator as unknown as {
      wakeLock?: { request: (t: string) => Promise<WakeSentinel> }
    }).wakeLock
    wl?.request('screen').then((s) => (sentinel = s)).catch(() => {})
    return () => {
      sentinel?.release().catch(() => {})
      clearTimer()
      if (recRef.current?.state === 'recording') {
        recRef.current.onstop = null
        recRef.current.stop()
      }
    }
  }, [])

  useEffect(() => () => {
    if (clip) URL.revokeObjectURL(clip.url)
  }, [clip])

  const chooseCountdown = (n: number) => {
    setCountdown(n)
    try {
      localStorage.setItem(COUNTDOWN_KEY, String(n))
    } catch {
      /* per-device convenience only */
    }
  }

  const beginRecording = () => {
    const stream = streamRef.current
    if (!stream) return
    const mime = pickMime()
    const rec = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: BITRATE,
    })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      // MediaRecorder WebM reports no duration, so trust the wall clock.
      const sec = Math.min(MAX_SEC, Math.round((Date.now() - startRef.current) / 1000))
      const type = (rec.mimeType || mime || 'video/webm').split(';')[0]
      const ext = type === 'video/mp4' ? 'mp4' : 'webm'
      const file = new File(chunks, `form.${ext}`, { type })
      setClip({ file, url: URL.createObjectURL(file), sec })
      setPhase('review')
    }
    recRef.current = rec
    rec.start(1000)
    startRef.current = Date.now()
    setElapsed(0)
    setPhase('recording')
    timerRef.current = window.setInterval(() => {
      const s = (Date.now() - startRef.current) / 1000
      setElapsed(Math.min(MAX_SEC, Math.floor(s)))
      if (s >= MAX_SEC) stopRecording()
    }, 250)
  }

  const stopRecording = () => {
    clearTimer()
    if (recRef.current?.state === 'recording') recRef.current.stop()
  }

  const onShutter = () => {
    if (phase === 'recording') return stopRecording()
    if (phase === 'countdown') {
      clearTimer()
      return setPhase('ready')
    }
    if (countdown === 0) return beginRecording()
    setLeft(countdown)
    setPhase('countdown')
    let n = countdown
    timerRef.current = window.setInterval(() => {
      n -= 1
      if (n > 0) return setLeft(n)
      clearTimer()
      beginRecording()
    }, 1000)
  }

  const retake = () => {
    setClip(null)
    upload.reset()
    setPhase('ready')
  }

  const save = (replace_id?: string) => {
    if (!clip || !key) return
    if (!replace_id && clips.length >= MAX_CLIPS) return setReplacing(true)
    upload.mutate(
      { exercise_key: key, file: clip.file, duration_sec: clip.sec, replace_id },
      { onSuccess: () => nav(-1) },
    )
  }

  const fmt = (s: number) => `0:${String(s).padStart(2, '0')}`

  return (
    <div className="mx-auto flex h-svh w-full max-w-md flex-col bg-black pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-white">
      <div className="flex items-center justify-between px-3 py-3">
        <button aria-label="Close" className="p-2" onClick={() => nav(-1)}>
          <X className="h-6 w-6" />
        </button>
        {phase === 'review' && clip ? (
          <span className="text-sm text-white/70">Review · {fmt(clip.sec)}</span>
        ) : (
          <span
            className={cn(
              'rounded-full bg-white/15 px-3 py-0.5 text-sm tabular-nums',
              phase === 'recording' && 'bg-red-600',
            )}
          >
            {fmt(elapsed)} / {fmt(MAX_SEC)}
          </span>
        )}
        <button
          aria-label="Flip camera"
          className="p-2 disabled:opacity-30"
          disabled={phase !== 'ready'}
          onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
        >
          <SwitchCamera className="h-6 w-6" />
        </button>
      </div>

      <div className="relative mx-3 flex-1 overflow-hidden rounded-xl bg-neutral-900">
        {phase === 'review' && clip ? (
          <video
            src={clip.url}
            controls
            autoPlay
            playsInline
            className="h-full w-full object-contain"
          />
        ) : (
          <video
            ref={previewRef}
            autoPlay
            muted
            playsInline
            className={cn('h-full w-full object-cover', facing === 'user' && '-scale-x-100')}
          />
        )}
        {camError && phase !== 'review' && (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">
            {camError}
          </p>
        )}
        {phase === 'countdown' && (
          <span className="absolute inset-0 flex items-center justify-center text-8xl font-semibold tabular-nums">
            {left}
          </span>
        )}
      </div>

      {phase === 'review' && clip ? (
        <div className="space-y-2 px-3 pt-4 pb-5">
          <div className="grid grid-cols-2 gap-3">
            <button
              className="flex items-center justify-center gap-2 rounded-lg border border-white/30 py-2.5"
              onClick={retake}
              disabled={upload.isPending}
            >
              <RotateCcw className="h-4 w-4" /> Retake
            </button>
            <button
              className="flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-medium text-primary-foreground disabled:opacity-60"
              onClick={() => save()}
              disabled={upload.isPending}
            >
              <Check className="h-4 w-4" /> {upload.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="text-center text-xs text-white/50">
            {clip.file.type === 'video/mp4' ? 'MP4' : 'WebM'} ·{' '}
            {(clip.file.size / 1048576).toFixed(1)} MB
          </p>
          {upload.error && (
            <p className="text-center text-xs text-red-400">{upload.error.message}</p>
          )}
          {replacing && (
            <ReplaceClipSheet
              clips={clips}
              pending={upload.isPending}
              onConfirm={(id) => save(id)}
              onClose={() => setReplacing(false)}
            />
          )}
        </div>
      ) : (
        <div className="px-3 pt-3 pb-5">
          <div className="flex items-center justify-center gap-1.5">
            <span className="mr-1 text-xs text-white/60">Countdown</span>
            {COUNTDOWNS.map((n) => (
              <button
                key={n}
                disabled={phase !== 'ready'}
                onClick={() => chooseCountdown(n)}
                className={cn(
                  'rounded-full border border-white/30 px-3 py-1 text-xs',
                  countdown === n && 'border-primary bg-primary',
                )}
              >
                {n === 0 ? 'Off' : `${n}s`}
              </button>
            ))}
          </div>
          <div className="flex justify-center pt-4">
            <button
              aria-label={phase === 'recording' ? 'Stop recording' : 'Start recording'}
              disabled={!!camError}
              onClick={onShutter}
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white disabled:opacity-40"
            >
              <span
                className={cn(
                  'bg-red-600 transition-all',
                  phase === 'recording' ? 'h-6 w-6 rounded-md' : 'h-12 w-12 rounded-full',
                )}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
