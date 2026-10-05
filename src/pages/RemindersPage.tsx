import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Flame } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { todayISO } from '@/lib/date'
import { isNativeApp } from '@/lib/restTimerNative'
import {
  MEAL_SLOTS,
  MEAL_LABELS,
  getReminderSettings,
  saveReminderSettings,
  remindersAvailable,
  requestRemindersPermission,
  syncMealReminders,
  syncStreakNudge,
  sendTestNotification,
  type ReminderSettings,
  type MealSlot,
} from '@/lib/reminders'

export function RemindersPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [settings, setSettings] = useState<ReminderSettings>(getReminderSettings)
  // null = still probing; false = web browser OR an APK without the plugin.
  const [available, setAvailable] = useState<boolean | null>(null)
  const [permErr, setPermErr] = useState(false)
  const [testSent, setTestSent] = useState(false)

  useEffect(() => {
    void remindersAvailable().then(setAvailable)
  }, [])

  const enabled = available === true
  // Whether anything's logged today, from the diary cache — good enough to arm
  // the nudge in the right direction; the DiaryPage effect corrects it live.
  const loggedToday =
    (qc.getQueryData<unknown[]>(['diary', todayISO()])?.length ?? 0) > 0

  const apply = (next: ReminderSettings) => {
    setSettings(next)
    saveReminderSettings(next)
    void syncMealReminders()
    void syncStreakNudge(loggedToday)
  }

  // Turning any reminder ON asks for notification permission first; a denial
  // leaves the toggle off and shows the settings hint.
  const turnOn = async (next: ReminderSettings) => {
    if (!(await requestRemindersPermission())) {
      setPermErr(true)
      return
    }
    setPermErr(false)
    apply(next)
  }

  const setMeal = (slot: MealSlot, patch: Partial<{ on: boolean; time: string }>) => ({
    ...settings,
    meals: {
      ...settings.meals,
      [slot]: { ...settings.meals[slot], ...patch },
    },
  })

  const doTest = async () => {
    await sendTestNotification()
    setTestSent(true)
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title="Reminders"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/more')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        {available === false && (
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">
              {isNativeApp()
                ? 'Update the FitLog app to the latest version to turn on reminders.'
                : 'Reminders ring from the FitLog Android app — they can’t be scheduled from the browser. Your settings below are per device.'}
            </p>
          </Card>
        )}

        <Card className="divide-y divide-border overflow-hidden">
          <div className="p-4 pb-2">
            <p className="text-sm font-medium">Meal reminders</p>
            <p className="text-xs text-muted-foreground">
              A daily nudge to log each meal, even with the app closed
            </p>
          </div>
          {MEAL_SLOTS.map((slot) => {
            const s = settings.meals[slot]
            return (
              <div key={slot} className="flex items-center gap-3 p-4">
                <span className="flex-1 text-sm font-medium">
                  {MEAL_LABELS[slot]}
                </span>
                <input
                  type="time"
                  value={s.time}
                  disabled={!enabled || !s.on}
                  onChange={(e) => {
                    if (e.target.value)
                      apply(setMeal(slot, { time: e.target.value }))
                  }}
                  className="rounded-md border border-input bg-card px-2 py-1 text-sm text-foreground disabled:opacity-50"
                />
                <Switch
                  checked={s.on}
                  disabled={!enabled}
                  label={`${MEAL_LABELS[slot]} reminder`}
                  onClick={() => {
                    if (s.on) apply(setMeal(slot, { on: false }))
                    else void turnOn(setMeal(slot, { on: true }))
                  }}
                />
              </div>
            )
          })}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 p-4">
            <Flame className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">Streak check-in</p>
              <p className="text-xs text-muted-foreground">
                Rings only on days you haven’t logged any food yet
              </p>
            </div>
            <input
              type="time"
              value={settings.streak.time}
              disabled={!enabled || !settings.streak.on}
              onChange={(e) => {
                if (e.target.value)
                  apply({
                    ...settings,
                    streak: { ...settings.streak, time: e.target.value },
                  })
              }}
              className="rounded-md border border-input bg-card px-2 py-1 text-sm text-foreground disabled:opacity-50"
            />
            <Switch
              checked={settings.streak.on}
              disabled={!enabled}
              label="Streak check-in"
              onClick={() => {
                const next = {
                  ...settings,
                  streak: { ...settings.streak, on: !settings.streak.on },
                }
                if (settings.streak.on) apply(next)
                else void turnOn(next)
              }}
            />
          </div>
        </Card>

        {permErr && (
          <p className="px-1 text-sm text-destructive">
            Notifications are blocked for FitLog. Allow them in Android Settings
            → Apps → FitLog → Notifications, then try again.
          </p>
        )}

        {enabled && (
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void doTest()}
            >
              Send a test notification
            </Button>
            {testSent && (
              <p className="text-center text-xs text-muted-foreground">
                Sent — check your notification shade.
              </p>
            )}
          </div>
        )}

        <p className="px-1 text-xs text-muted-foreground">
          Reminders ring on this phone at its local time, even when the app is
          closed. They may arrive a few minutes late while the phone is dozing.
        </p>
      </div>
    </div>
  )
}
