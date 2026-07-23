import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Lock, Fingerprint } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import {
  getBiometricLock,
  biometricAvailable,
  biometricAuthenticate,
  onAppForeground,
} from '@/lib/biometric'

/**
 * Level-1 biometric privacy gate. When the user has enabled unlock and the
 * device supports it, the app content is covered by an opaque lock screen until
 * a fingerprint/face scan passes — on cold start and again after the app is
 * backgrounded and returns. Children stay MOUNTED behind the cover (so a
 * running rest timer / navigation state survives a re-lock); the cover just
 * sits on top. Everything is a no-op on web / older APKs, so the browser PWA
 * never locks. Escape hatch: "Sign in with password" signs out to the login
 * screen, so a broken biometric never traps the only device.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const { signOut } = useAuth()
  // Start locked when the pref is on, so app content is never shown for a frame
  // before the cover mounts; availability is confirmed async below.
  const [unlocked, setUnlocked] = useState(() => !getBiometricLock())
  const authenticating = useRef(false)
  const unlockedRef = useRef(unlocked)
  useEffect(() => {
    unlockedRef.current = unlocked
  }, [unlocked])

  // Idempotent — a prompt already in flight is not re-shown (guards against the
  // mount effect and a launch appStateChange both firing).
  const runPrompt = useCallback(async () => {
    if (authenticating.current) return
    authenticating.current = true
    try {
      if (await biometricAuthenticate()) setUnlocked(true)
    } finally {
      authenticating.current = false
    }
  }, [])

  // Cold start: prompt if locked; fail OPEN if biometrics vanished (e.g. the
  // user removed their fingerprints) so they're never trapped.
  useEffect(() => {
    if (!getBiometricLock()) return
    let cancelled = false
    void biometricAvailable().then((ok) => {
      if (cancelled) return
      if (!ok) setUnlocked(true)
      else void runPrompt()
    })
    return () => {
      cancelled = true
    }
  }, [runPrompt])

  // Re-lock when the app returns to the foreground — but only if we were
  // unlocked, so spurious active events while the prompt is up don't loop.
  useEffect(() => {
    if (!getBiometricLock()) return
    return onAppForeground(() => {
      if (unlockedRef.current) {
        setUnlocked(false)
        void runPrompt()
      }
    })
  }, [runPrompt])

  return (
    <>
      {children}
      {!unlocked && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background p-8 pb-[env(safe-area-inset-bottom)]">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
            <Lock className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold">FitLog is locked</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Unlock with your fingerprint or face to continue.
            </p>
          </div>
          <div className="flex w-full max-w-xs flex-col gap-2">
            <Button className="w-full" onClick={() => void runPrompt()}>
              <Fingerprint className="h-4 w-4" /> Unlock
            </Button>
            <button
              onClick={() => void signOut()}
              className="p-2 text-sm text-muted-foreground active:text-foreground"
            >
              Sign in with password instead
            </button>
          </div>
        </div>
      )}
    </>
  )
}
