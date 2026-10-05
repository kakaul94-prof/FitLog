// Meal-logging reminders + a streak-save nudge, scheduled as native local
// notifications. Android app only — the browser PWA can't fire scheduled
// notifications reliably, so every call here no-ops on the web (and the
// try/catch swallows the live-URL case where an older APK lacks the plugin,
// same pattern as restTimerNative).
//
// Meals are repeating daily alarms at a fixed local time. The streak nudge is
// a ONE-SHOT the app keeps re-arming: logging food for today pushes it to
// tomorrow evening, an empty day pulls it back — so it only ever rings on a
// day with nothing logged (see the DiaryPage effect + useDiary onMutate).
// Settings live in localStorage (per device, like the theme) — no schema.
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snacks'

export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snacks']

export const MEAL_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snacks',
}

export interface ReminderSettings {
  meals: Record<MealSlot, { on: boolean; time: string }>
  streak: { on: boolean; time: string }
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  meals: {
    breakfast: { on: false, time: '08:00' },
    lunch: { on: false, time: '12:30' },
    dinner: { on: false, time: '18:30' },
    snacks: { on: false, time: '15:00' },
  },
  streak: { on: false, time: '20:00' },
}

const STORE_KEY = 'fitlog:reminders'
const CHANNEL_ID = 'reminders'
const MEAL_IDS: Record<MealSlot, number> = {
  breakfast: 101,
  lunch: 102,
  dinner: 103,
  snacks: 104,
}
const STREAK_ID = 110
const TEST_ID = 199

export function getReminderSettings(): ReminderSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return DEFAULT_REMINDERS
    const p = JSON.parse(raw) as Partial<ReminderSettings>
    return {
      meals: { ...DEFAULT_REMINDERS.meals, ...(p.meals ?? {}) },
      streak: { ...DEFAULT_REMINDERS.streak, ...(p.streak ?? {}) },
    }
  } catch {
    return DEFAULT_REMINDERS
  }
}

export function saveReminderSettings(s: ReminderSettings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

/** 'HH:MM' → clamped hour/minute; unparsable input falls back to 00:00. */
export function parseTime(t: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t)
  return {
    hour: Math.min(23, Math.max(0, Number(m?.[1] ?? 0))),
    minute: Math.min(59, Math.max(0, Number(m?.[2] ?? 0))),
  }
}

/**
 * Next wall-clock Date a daily reminder at `time` should ring: today if that
 * time is still ahead (unless skipToday, i.e. today's already handled), else
 * tomorrow.
 */
export function nextFireAt(time: string, now: Date, skipToday: boolean): Date {
  const { hour, minute } = parseTime(time)
  const d = new Date(now)
  d.setHours(hour, minute, 0, 0)
  if (skipToday || d <= now) d.setDate(d.getDate() + 1)
  return d
}

const native = () => Capacitor.isNativePlatform()

/** True when the packaged app can actually schedule (plugin present). */
export async function remindersAvailable(): Promise<boolean> {
  if (!native()) return false
  try {
    await LocalNotifications.checkPermissions()
    return true
  } catch {
    return false
  }
}

export async function requestRemindersPermission(): Promise<boolean> {
  try {
    return (await LocalNotifications.requestPermissions()).display === 'granted'
  } catch {
    return false
  }
}

async function ensureChannel(): Promise<void> {
  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Reminders',
    description: 'Meal logging reminders and streak alerts',
    importance: 4,
  })
}

/** Re-arm the repeating meal reminders to match the saved settings. */
export async function syncMealReminders(): Promise<void> {
  if (!native()) return
  try {
    const s = getReminderSettings()
    await LocalNotifications.cancel({
      notifications: MEAL_SLOTS.map((m) => ({ id: MEAL_IDS[m] })),
    })
    const notifications = MEAL_SLOTS.filter((m) => s.meals[m].on).map((m) => ({
      id: MEAL_IDS[m],
      title: `Log your ${MEAL_LABELS[m].toLowerCase()}`,
      body: 'Tap to add it to your diary.',
      channelId: CHANNEL_ID,
      extra: { path: `/diary/add?meal=${m}` },
      schedule: { on: parseTime(s.meals[m].time), allowWhileIdle: true },
    }))
    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications })
    }
  } catch {
    /* plugin missing (web / older APK) */
  }
}

/**
 * Re-arm the one-shot streak nudge. Call whenever "anything logged today"
 * changes: true schedules tomorrow evening, false schedules today's (if the
 * time hasn't passed). Off in settings = just cancels.
 */
export async function syncStreakNudge(loggedToday: boolean): Promise<void> {
  if (!native()) return
  try {
    const s = getReminderSettings()
    await LocalNotifications.cancel({ notifications: [{ id: STREAK_ID }] })
    if (!s.streak.on) return
    await LocalNotifications.schedule({
      notifications: [
        {
          id: STREAK_ID,
          title: 'Your streak is on the line 🔥',
          body: 'Nothing logged today — one food keeps it going.',
          channelId: CHANNEL_ID,
          extra: { path: '/' },
          schedule: {
            at: nextFireAt(s.streak.time, new Date(), loggedToday),
            allowWhileIdle: true,
          },
        },
      ],
    })
  } catch {
    /* plugin missing */
  }
}

/** Show one immediately — proves permission + delivery on this device. */
export async function sendTestNotification(): Promise<void> {
  try {
    await ensureChannel()
    await LocalNotifications.schedule({
      notifications: [
        {
          id: TEST_ID,
          title: 'Reminders are working',
          body: "This is how they'll look.",
          channelId: CHANNEL_ID,
        },
      ],
    })
  } catch {
    /* plugin missing */
  }
}

/**
 * App-start wiring: create the channel, deep-link notification taps, and
 * re-arm the meal alarms (covers reboots / APK updates clearing them). The
 * streak nudge re-arms from DiaryPage once today's entries load.
 */
export function initReminders(navigate: (path: string) => void): void {
  if (!native()) return
  void (async () => {
    try {
      await ensureChannel()
      await LocalNotifications.addListener(
        'localNotificationActionPerformed',
        (event) => {
          const path = (event.notification.extra as { path?: unknown })?.path
          if (typeof path === 'string') navigate(path)
        },
      )
    } catch {
      return /* plugin missing — nothing to arm */
    }
    await syncMealReminders()
  })()
}
