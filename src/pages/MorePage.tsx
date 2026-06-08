import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  User,
  LogOut,
  ChevronRight,
  Apple,
  ChefHat,
  Utensils,
  Download,
  Sun,
  Moon,
  Monitor,
  Palette,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { exportData } from '@/features/settings/exportData'
import { cn } from '@/lib/utils'
import { useTheme, type Theme } from '@/lib/theme'

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

export function MorePage() {
  const { user, signOut } = useAuth()
  const [exporting, setExporting] = useState(false)
  const [theme, setTheme] = useTheme()

  const doExport = async () => {
    setExporting(true)
    try {
      await exportData()
    } finally {
      setExporting(false)
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
            <Apple className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">My Foods</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link
            to="/recipes"
            className="flex items-center gap-3 p-4 active:bg-accent"
          >
            <ChefHat className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">Recipes</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link
            to="/meals"
            className="flex items-center gap-3 p-4 active:bg-accent"
          >
            <Utensils className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">Saved Meals</span>
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
        </Card>

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
    </div>
  )
}
