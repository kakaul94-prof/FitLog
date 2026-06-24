import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  User,
  LogOut,
  ChevronRight,
  Library,
  Download,
  Upload,
  Sun,
  Moon,
  Monitor,
  Palette,
  Volume2,
  Bell,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { exportData } from '@/features/settings/exportData'
import {
  validateBackup,
  restoreBackup,
  type ParsedBackup,
} from '@/features/settings/importData'
import { cn } from '@/lib/utils'
import { useTheme, type Theme } from '@/lib/theme'
import {
  getChime,
  setChime,
  getNotify,
  setNotify,
  notifySupported,
  previewChime,
  notifyPhone,
  requestNotifyPermission,
} from '@/lib/restTimer'

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

// Friendly names for the headline tables shown in the restore confirm.
const RESTORE_LABELS: Record<string, string> = {
  foods: 'foods',
  recipe_ingredients: 'recipe ingredients',
  diary_entries: 'diary entries',
  meals: 'saved meals',
  exercise_entries: 'cardio entries',
  workouts: 'workouts',
  measurements: 'measurements',
  strength_goals: 'strength goals',
}

export function MorePage() {
  const { user, signOut } = useAuth()
  const [exporting, setExporting] = useState(false)
  const [theme, setTheme] = useTheme()
  const [chime, setChimeOn] = useState(getChime)
  const [notify, setNotifyOn] = useState(
    () =>
      getNotify() && notifySupported() && Notification.permission === 'granted',
  )

  const toggleChime = () => {
    const next = !chime
    setChimeOn(next)
    setChime(next)
    if (next) previewChime() // hear it + unlock audio on the tap
  }
  const toggleNotify = async () => {
    if (notify) {
      setNotifyOn(false)
      setNotify(false)
      return
    }
    const granted = await requestNotifyPermission()
    if (!granted) return
    setNotifyOn(true)
    setNotify(true)
    // Immediate confirmation banner — proves permission + delivery work.
    notifyPhone(
      'Notifications on',
      'You’ll get a banner when each rest finishes.',
    )
  }

  const doExport = async () => {
    setExporting(true)
    try {
      await exportData()
    } finally {
      setExporting(false)
    }
  }

  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<ParsedBackup | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreErr, setRestoreErr] = useState<string | null>(null)

  const onPickBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setRestoreErr(null)
    try {
      setPending(validateBackup(await file.text()))
    } catch (err) {
      setRestoreErr(err instanceof Error ? err.message : 'Could not read file.')
    }
  }

  const doRestore = async () => {
    if (!pending || !user) return
    setRestoring(true)
    setRestoreErr(null)
    try {
      await restoreBackup(pending, user.id)
      window.location.reload() // reload so every cache + the profile re-read
    } catch (err) {
      setRestoreErr(err instanceof Error ? err.message : 'Restore failed.')
      setRestoring(false)
      setPending(null)
    }
  }

  return (
    <div>
      <PageHeader title="More" />
      <div className="space-y-4 p-4">
        <Card className="divide-y divide-border overflow-hidden">
          <Link
            to="/profile"
            className="flex items-center gap-3 p-4 active:bg-accent"
          >
            <User className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">Profile &amp; Goals</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link
            to="/foods"
            className="flex items-center gap-3 p-4 active:bg-accent"
          >
            <Library className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">Food Library</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 p-4">
            <Palette className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">Appearance</span>
            <div className="flex rounded-lg bg-secondary p-0.5">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
                const active = theme === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTheme(value)}
                    aria-label={label}
                    aria-pressed={active}
                    className={cn(
                      'flex h-8 w-9 items-center justify-center rounded-md transition-colors',
                      active
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground active:bg-accent',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                )
              })}
            </div>
          </div>
        </Card>

        <Card className="divide-y divide-border overflow-hidden">
          <div className="flex items-center gap-3 p-4">
            <Volume2 className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">Rest timer chime</p>
              <p className="text-xs text-muted-foreground">
                Play a sound when the rest timer ends
              </p>
            </div>
            <Switch
              checked={chime}
              onClick={toggleChime}
              label="Rest timer chime"
            />
          </div>
          {notifySupported() && (
            <div className="flex items-center gap-3 p-4">
              <Bell className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">Rest timer notification</p>
                <p className="text-xs text-muted-foreground">
                  Show a phone banner when the rest timer ends
                </p>
              </div>
              <Switch
                checked={notify}
                onClick={() => void toggleNotify()}
                label="Rest timer notification"
              />
            </div>
          )}
        </Card>

        <Card className="divide-y divide-border overflow-hidden">
          <button
            onClick={doExport}
            disabled={exporting}
            className="flex w-full items-center gap-3 p-4 active:bg-accent disabled:opacity-50"
          >
            <Download className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 text-left text-sm font-medium">
              {exporting ? 'Exporting…' : 'Export my data (JSON)'}
            </span>
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center gap-3 p-4 active:bg-accent"
          >
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 text-left text-sm font-medium">
              Restore from backup (JSON)
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onPickBackup}
          />
        </Card>
        {restoreErr && !pending && (
          <p className="px-1 text-center text-sm text-destructive">
            {restoreErr}
          </p>
        )}

        {user?.email && (
          <p className="text-center text-xs text-muted-foreground">
            Signed in as {user.email}
          </p>
        )}
        <Button
          variant="outline"
          className="w-full"
          onClick={() => void signOut()}
        >
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>

      {pending &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={() => !restoring && setPending(null)}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(ev) => ev.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="border-b border-border p-3 text-center text-sm font-medium">
                  Restore from backup?
                </div>
                <div className="space-y-3 p-4">
                  <p className="text-sm text-muted-foreground">
                    This replaces{' '}
                    <span className="font-medium text-foreground">
                      everything
                    </span>{' '}
                    currently in your account with this backup. It can’t be
                    undone.
                  </p>
                  <ul className="space-y-1 rounded-lg bg-secondary p-3 text-sm">
                    {pending.counts
                      .filter((c) => RESTORE_LABELS[c.table] && c.count > 0)
                      .map((c) => (
                        <li
                          key={c.table}
                          className="flex justify-between gap-2"
                        >
                          <span className="text-muted-foreground">
                            {RESTORE_LABELS[c.table]}
                          </span>
                          <span className="font-medium">{c.count}</span>
                        </li>
                      ))}
                    <li className="flex justify-between gap-2 border-t border-border pt-1 text-muted-foreground">
                      <span>total records</span>
                      <span className="font-medium text-foreground">
                        {pending.counts.reduce((s, c) => s + c.count, 0)}
                      </span>
                    </li>
                  </ul>
                  {restoreErr && (
                    <p className="text-sm text-destructive">{restoreErr}</p>
                  )}
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={restoring}
                    onClick={doRestore}
                  >
                    {restoring ? 'Restoring…' : 'Replace my data'}
                  </Button>
                </div>
              </Card>
              <button
                onClick={() => setPending(null)}
                disabled={restoring}
                className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

function Switch({
  checked,
  onClick,
  label,
}: {
  checked: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          checked && 'translate-x-5',
        )}
      />
    </button>
  )
}
