import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  User,
  LogOut,
  ChevronRight,
  Apple,
  ChefHat,
  Download,
  Flame,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { useProfile, useUpdateProfile } from '@/features/profile/useProfile'
import { exportData } from '@/features/settings/exportData'

export function MorePage() {
  const { user, signOut } = useAuth()
  const { data: profile } = useProfile()
  const updateProfile = useUpdateProfile()
  const [exporting, setExporting] = useState(false)

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
        </Card>

        <Card className="divide-y divide-border overflow-hidden">
          <label className="flex items-center gap-3 p-4">
            <Flame className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <div className="text-sm font-medium">
                Add exercise calories back
              </div>
              <div className="text-xs text-muted-foreground">
                Burned calories raise your daily budget
              </div>
            </div>
            <input
              type="checkbox"
              className="h-5 w-5 accent-[var(--primary)]"
              checked={!!profile?.eat_back_exercise}
              onChange={(e) =>
                updateProfile.mutate({ eat_back_exercise: e.target.checked })
              }
            />
          </label>
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
