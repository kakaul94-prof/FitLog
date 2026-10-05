import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Battery, ChevronLeft, ChevronRight, HeartPulse } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useProfile } from '@/features/profile/useProfile'
import { useHrMonitor } from '@/features/hr/useHrMonitor'
import {
  canAutoReconnect,
  connectHr,
  disconnectHr,
  forgetHrMonitor,
  hrAutoConnect,
  hrDiagnostics,
  hrSupported,
  pairHrMonitor,
  setHrAutoConnect,
} from '@/lib/hrWatch'
import { resolveHrZones, resolveMaxHr, resolveZoneForHr } from '@/lib/calc'
import { zoneColor } from '@/data/zones'
import { cn } from '@/lib/utils'

/**
 * Pair and check the chest strap. Everything here is about the radio; the zone
 * boundaries it colours against are set in Profile (max/resting HR), so those
 * are shown read-only with a link rather than duplicated.
 */
export function HeartRateMonitorPage() {
  const nav = useNavigate()
  const { data: profile } = useProfile()
  const hr = useHrMonitor()
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(hrAutoConnect)

  const supported = hrSupported()
  const zones = resolveHrZones(profile)
  const maxHr = resolveMaxHr(profile)
  const zone = hr.bpm ? resolveZoneForHr(hr.bpm, profile) : null
  const color = zone != null ? zoneColor(zone) : undefined

  // Reconnect on open so the page shows a live number without a tap. Native
  // only — the browser needs the picker gesture every time.
  useEffect(() => {
    if (hr.deviceId && hr.status === 'idle' && canAutoReconnect())
      void connectHr()
    // Only on mount: re-running on every status change would fight a disconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const forget = async () => {
    if (!confirm(`Forget ${hr.deviceName ?? 'this strap'}?`)) return
    await run(forgetHrMonitor)
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title="Heart rate monitor"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />

      <div className="space-y-4 p-4">
        {!supported ? (
          <Card>
            <CardContent className="space-y-2 p-4">
              <p className="text-sm font-medium">Bluetooth isn’t available here</p>
              <p className="text-xs text-muted-foreground">
                Chest straps need the installed Android app, or Chrome on
                desktop. Safari and iOS can’t reach Bluetooth from a web app at
                all.
              </p>
            </CardContent>
          </Card>
        ) : hr.deviceId ? (
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {hr.deviceName}
                  </p>
                  <p
                    className={cn(
                      'text-xs',
                      hr.status === 'connected'
                        ? 'text-primary'
                        : 'text-muted-foreground',
                    )}
                  >
                    {hr.status === 'connected'
                      ? hr.stale
                        ? 'Connected · no signal'
                        : 'Connected'
                      : hr.status === 'connecting'
                        ? 'Connecting…'
                        : 'Not connected'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className={cn(
                      'text-3xl font-bold tabular-nums leading-none',
                      hr.stale && 'opacity-40',
                    )}
                    style={color ? { color } : undefined}
                  >
                    {hr.bpm ?? '—'}
                  </div>
                  <div className="text-xs text-muted-foreground">bpm</div>
                </div>
              </div>

              {(hr.battery != null || hr.contact === false) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {hr.battery != null && (
                    <span className="flex items-center gap-1.5">
                      <Battery className="h-4 w-4" />
                      Battery {hr.battery}%
                    </span>
                  )}
                  {hr.contact === false && (
                    <span className="text-warning">
                      Strap isn’t making contact
                    </span>
                  )}
                </div>
              )}

              {zone != null && zones && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium" style={{ color }}>
                    Zone {zone}
                  </span>{' '}
                  · {zones[zone - 1].loBpm}–{zones[zone - 1].hiBpm} bpm ·{' '}
                  {zones[zone - 1].name}
                </p>
              )}

              {hr.error && <p className="text-xs text-warning">{hr.error}</p>}

              <div className="flex gap-2">
                {hr.status === 'connected' ? (
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => void run(disconnectHr)}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    className="flex-1"
                    disabled={busy || hr.status === 'connecting'}
                    onClick={() =>
                      void run(async () => {
                        if (!(await connectHr())) await pairHrMonitor()
                      })
                    }
                  >
                    Connect
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => void forget()}
                >
                  Forget
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start gap-2 rounded-lg bg-primary/10 p-3 text-sm">
                <HeartPulse className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  Wear the strap and damp the contacts first — it won’t
                  advertise until it reads a pulse.
                </span>
              </div>
              <Button
                className="w-full"
                size="lg"
                disabled={busy}
                onClick={() => void run(pairHrMonitor)}
              >
                Pair a strap
              </Button>
              {hr.error && <p className="text-xs text-warning">{hr.error}</p>}
            </CardContent>
          </Card>
        )}

        {supported && hr.deviceId && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex-1">
                <p className="text-sm font-medium">Connect when I start</p>
                <p className="text-xs text-muted-foreground">
                  Reach for the strap automatically when a recording begins
                </p>
              </div>
              <Switch
                checked={auto}
                label="Connect the strap when a recording starts"
                onClick={() => {
                  setAuto(!auto)
                  setHrAutoConnect(!auto)
                }}
              />
            </CardContent>
          </Card>
        )}

        <Card className="divide-y divide-border overflow-hidden">
          <Link
            to="/profile"
            className="flex items-center gap-3 p-4 active:bg-accent"
          >
            <div className="flex-1">
              <p className="text-sm font-medium">Max HR</p>
              <p className="text-xs text-muted-foreground">
                Sets where every zone boundary falls
              </p>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">
              {maxHr != null
                ? `${maxHr} bpm${profile?.max_hr == null ? ' (est.)' : ''}`
                : 'Not set'}
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link
            to="/profile"
            className="flex items-center gap-3 p-4 active:bg-accent"
          >
            <div className="flex-1">
              <p className="text-sm font-medium">Resting HR</p>
              <p className="text-xs text-muted-foreground">
                Switches zones to heart-rate reserve
              </p>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">
              {profile?.resting_hr != null
                ? `${profile.resting_hr} bpm`
                : 'Not set'}
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </Card>

        <p className="px-1 text-xs text-muted-foreground">
          A strap talks to one app at a time — close your watch or bike computer
          if it won’t connect.
          {!canAutoReconnect() &&
            ' In a browser you have to pick the strap again each visit; the installed app remembers it.'}
        </p>

        {/* Only once something has actually gone wrong — enough runtime detail
            to tell a stale APK from a strap that won't answer. */}
        {hr.error && (
          <div className="space-y-1 px-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {Object.entries(hrDiagnostics()).map(([k, v]) => (
              <p key={k} className="break-all">
                {k}={String(v)}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
