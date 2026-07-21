import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { supabase } from '@/lib/supabase'
import { useProfile, useUpdateProfile } from '@/features/profile/useProfile'
import { useDailySupplements } from '@/features/profile/useDailySupplements'
import { useFoods } from '@/features/foods/useFoods'
import {
  useLatestWeight,
  useLogMeasurement,
} from '@/features/measurements/useMeasurements'
import {
  ACTIVITY_LABELS,
  ageFromBirthDate,
  caloriesForRate,
  cmToFtIn,
  ftInToCm,
  hrMax,
  hrZones,
  recordGoalChange,
  resolveCalorieGoal,
  resolveMacroTargets,
} from '@/lib/calc'
import { zoneColor } from '@/data/zones'
import { useAdaptiveTDEE } from '@/features/insights/useAdaptiveTDEE'
import { todayISO } from '@/lib/date'
import type {
  ActivityLevel,
  DailySupplement,
  MacroMode,
  MacroTargets,
  Sex,
} from '@/lib/database.types'

const RATE_OPTIONS = [
  { v: '-2', label: 'Lose 2 lb / week' },
  { v: '-1.5', label: 'Lose 1.5 lb / week' },
  { v: '-1', label: 'Lose 1 lb / week' },
  { v: '-0.5', label: 'Lose 0.5 lb / week' },
  { v: '0', label: 'Maintain weight' },
  { v: '0.5', label: 'Gain 0.5 lb / week' },
  { v: '1', label: 'Gain 1 lb / week' },
]

const ACTIVITY_ORDER: ActivityLevel[] = [
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
]

export function ProfilePage() {
  const nav = useNavigate()
  const { data: profile, isLoading } = useProfile()
  const { data: latestWeight } = useLatestWeight()
  const { data: adaptive } = useAdaptiveTDEE()
  const updateProfile = useUpdateProfile()
  const logWeight = useLogMeasurement()
  const [adaptiveApplied, setAdaptiveApplied] = useState(false)

  const [sex, setSex] = useState<Sex | ''>('')
  const [birthDate, setBirthDate] = useState('')
  const [ft, setFt] = useState('')
  const [inch, setInch] = useState('')
  const [activity, setActivity] = useState<ActivityLevel>('moderate')
  const [maxHrMode, setMaxHrMode] = useState<'age' | 'manual'>('age')
  const [maxHr, setMaxHr] = useState('')
  const [restingHr, setRestingHr] = useState('')
  const [showHrTips, setShowHrTips] = useState(false)
  const [weight, setWeight] = useState('')
  const [rate, setRate] = useState('0')
  const [goalWeight, setGoalWeight] = useState('')
  const [manualMode, setManualMode] = useState(false)
  const [manualCal, setManualCal] = useState('')
  const [proteinMode, setProteinMode] = useState<MacroMode>('g_per_lb')
  const [proteinVal, setProteinVal] = useState('0.9')
  const [fatMode, setFatMode] = useState<MacroMode>('pct')
  const [fatVal, setFatVal] = useState('30')
  const [carbMode, setCarbMode] = useState<MacroMode>('remainder')
  const [carbVal, setCarbVal] = useState('40')
  const [saved, setSaved] = useState(false)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwStatus, setPwStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')
  const [pwError, setPwError] = useState('')

  useEffect(() => {
    if (!profile) return
    setSex(profile.sex ?? '')
    setBirthDate(profile.birth_date ?? '')
    if (profile.height_cm) {
      const { ft: f, inch: i } = cmToFtIn(profile.height_cm)
      setFt(String(f))
      setInch(String(i))
    }
    setActivity(profile.activity_level)
    setMaxHrMode(profile.max_hr != null ? 'manual' : 'age')
    setMaxHr(profile.max_hr != null ? String(profile.max_hr) : '')
    setRestingHr(profile.resting_hr != null ? String(profile.resting_hr) : '')
    setRate(String(profile.goal_rate_lb_per_week))
    setGoalWeight(profile.goal_weight_lb != null ? String(profile.goal_weight_lb) : '')
    setManualMode(profile.calorie_goal_mode === 'manual')
    setManualCal(
      profile.manual_calorie_goal != null
        ? String(profile.manual_calorie_goal)
        : '',
    )
    const mt = profile.macro_targets
    if (mt?.protein) {
      setProteinMode(mt.protein.mode)
      if (mt.protein.value != null) setProteinVal(String(mt.protein.value))
    }
    if (mt?.fat) {
      setFatMode(mt.fat.mode)
      if (mt.fat.value != null) setFatVal(String(mt.fat.value))
    }
    if (mt?.carb) {
      setCarbMode(mt.carb.mode)
      if (mt.carb.value != null) setCarbVal(String(mt.carb.value))
    }
  }, [profile])

  useEffect(() => {
    if (latestWeight != null) setWeight(String(latestWeight))
  }, [latestWeight])

  const weightNum = parseFloat(weight) || null
  const heightCm =
    ft || inch ? ftInToCm(parseInt(ft) || 0, parseInt(inch) || 0) : null

  // Live HR-zone preview from the in-form values (before save).
  const ageForHr = ageFromBirthDate(birthDate || null)
  const estMaxHr = ageForHr != null ? hrMax(ageForHr) : null
  const effMaxHr = maxHrMode === 'manual' ? parseInt(maxHr) || null : estMaxHr
  const restingHrNum = parseInt(restingHr) || null
  const hrPreview = effMaxHr != null ? hrZones(effMaxHr, restingHrNum) : null
  const usingKarvonen =
    effMaxHr != null &&
    restingHrNum != null &&
    restingHrNum > 0 &&
    restingHrNum < effMaxHr

  const goal = resolveCalorieGoal(
    {
      sex: sex || null,
      birth_date: birthDate || null,
      height_cm: heightCm,
      activity_level: activity,
      goal_rate_lb_per_week: parseFloat(rate) || 0,
      calorie_goal_mode: manualMode ? 'manual' : 'calculated',
      manual_calorie_goal: parseInt(manualCal) || null,
    },
    weightNum,
  )
  const calories = goal.goal ?? goal.calculated ?? 0

  // Goal implied by the data-driven maintenance + the chosen weekly rate.
  const adaptiveGoal =
    adaptive?.enough && adaptive.tdee != null
      ? Math.round(adaptive.tdee + caloriesForRate(parseFloat(rate) || 0))
      : null

  const macroTargets: MacroTargets = {
    protein: { mode: proteinMode, value: parseFloat(proteinVal) || 0 },
    fat: { mode: fatMode, value: parseFloat(fatVal) || 0 },
    carb:
      carbMode === 'remainder'
        ? { mode: 'remainder' }
        : { mode: carbMode, value: parseFloat(carbVal) || 0 },
  }
  const macros = resolveMacroTargets(calories, weightNum, macroTargets)
  const macroKcal = macros.protein.kcal + macros.carb.kcal + macros.fat.kcal
  const over = calories > 0 && macroKcal > calories + 5

  const onSave = async () => {
    setSaved(false)
    const r = parseFloat(rate) || 0
    // Record the change into the dated goal history so past days keep the goal
    // that was in effect then. `goal.goal` is the new goal from the form values.
    const oldGoal = profile
      ? resolveCalorieGoal(profile, latestWeight ?? null).goal
      : null
    const nextGoalHistory = recordGoalChange(profile?.calorie_goal_history, {
      today: todayISO(),
      oldGoal,
      newGoal: goal.goal,
    })
    await updateProfile.mutateAsync({
      sex: sex || null,
      birth_date: birthDate || null,
      height_cm: heightCm,
      activity_level: activity,
      goal_rate_lb_per_week: r,
      goal_type: r < 0 ? 'lose' : r > 0 ? 'gain' : 'maintain',
      goal_weight_lb: goalWeight ? parseFloat(goalWeight) : null,
      calorie_goal_mode: manualMode ? 'manual' : 'calculated',
      manual_calorie_goal: manualMode ? parseInt(manualCal) || null : null,
      calorie_goal_history: nextGoalHistory,
      macro_targets: macroTargets,
      max_hr: maxHrMode === 'manual' ? parseInt(maxHr) || null : null,
      resting_hr: restingHr.trim() ? parseInt(restingHr) || null : null,
    })
    if (weightNum != null && weightNum !== latestWeight) {
      await logWeight.mutateAsync({
        type: 'weight',
        value: weightNum,
        unit: 'lb',
        measured_on: todayISO(),
      })
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  // One-tap: switch to manual mode at the data-driven goal and persist it.
  const applyAdaptive = async () => {
    if (adaptiveGoal == null) return
    setManualMode(true)
    setManualCal(String(adaptiveGoal))
    const oldGoal = profile
      ? resolveCalorieGoal(profile, latestWeight ?? null).goal
      : null
    await updateProfile.mutateAsync({
      calorie_goal_mode: 'manual',
      manual_calorie_goal: adaptiveGoal,
      calorie_goal_history: recordGoalChange(profile?.calorie_goal_history, {
        today: todayISO(),
        oldGoal,
        newGoal: adaptiveGoal,
      }),
    })
    setAdaptiveApplied(true)
    setTimeout(() => setAdaptiveApplied(false), 2500)
  }

  const updatePassword = async () => {
    setPwError('')
    if (pw1.length < 6) {
      setPwError('Password must be at least 6 characters.')
      setPwStatus('error')
      return
    }
    if (pw1 !== pw2) {
      setPwError('Passwords do not match.')
      setPwStatus('error')
      return
    }
    setPwStatus('saving')
    const { error } = await supabase.auth.updateUser({ password: pw1 })
    if (error) {
      setPwError(error.message)
      setPwStatus('error')
    } else {
      setPwStatus('saved')
      setPw1('')
      setPw2('')
      setTimeout(() => setPwStatus('idle'), 2500)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-svh items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Profile & Goals"
        left={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => nav('/more')}
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />

      <div className="space-y-4 p-4">
        {/* Live daily targets */}
        <Card className="bg-primary text-primary-foreground">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide opacity-80">
              Daily target
            </p>
            <p className="text-3xl font-bold">
              {calories ? calories.toLocaleString() : '—'}
              <span className="ml-1 text-base font-medium opacity-80">calories</span>
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
              {(['protein', 'carb', 'fat'] as const).map((k) => (
                <div key={k} className="rounded-lg bg-white/15 py-1.5">
                  <div className="font-semibold">{macros[k].grams} g</div>
                  <div className="text-xs capitalize opacity-80">
                    {k === 'carb' ? 'carbs' : k} · {macros[k].pct}%
                  </div>
                </div>
              ))}
            </div>
            {over && (
              <p className="mt-2 text-xs font-medium text-yellow-200">
                Macros add up to more than your calorie target — adjust below.
              </p>
            )}
            {goal.mode === 'calculated' && goal.missing.length > 0 && (
              <p className="mt-2 text-xs opacity-90">
                Add {goal.missing.join(', ')} to calculate your goal.
              </p>
            )}
          </CardContent>
        </Card>

        {/* About you */}
        <Card>
          <CardHeader>
            <CardTitle>About you</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Sex</Label>
              <Select
                value={sex}
                onChange={(e) => setSex(e.target.value as Sex | '')}
              >
                <option value="">Select…</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bd">Birth date</Label>
              <Input
                id="bd"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Height</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="ft"
                    value={ft}
                    onChange={(e) => setFt(e.target.value)}
                  />
                </div>
                <div className="relative flex-1">
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="in"
                    value={inch}
                    onChange={(e) => setInch(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Activity level</Label>
              <Select
                value={activity}
                onChange={(e) => setActivity(e.target.value as ActivityLevel)}
              >
                {ACTIVITY_ORDER.map((a) => (
                  <option key={a} value={a}>
                    {ACTIVITY_LABELS[a]}
                  </option>
                ))}
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Heart rate */}
        <Card>
          <CardHeader>
            <CardTitle>Heart rate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Max heart rate</Label>
              <div className="flex gap-2">
                <label className="flex flex-1 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="maxhrmode"
                    checked={maxHrMode === 'age'}
                    onChange={() => setMaxHrMode('age')}
                    className="h-4 w-4 accent-primary"
                  />
                  From age{estMaxHr != null ? ` (${estMaxHr})` : ''}
                </label>
                <label className="flex flex-1 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="maxhrmode"
                    checked={maxHrMode === 'manual'}
                    onChange={() => setMaxHrMode('manual')}
                    className="h-4 w-4 accent-primary"
                  />
                  Set manually
                </label>
              </div>
              {maxHrMode === 'manual' && (
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 190"
                  value={maxHr}
                  onChange={(e) => setMaxHr(e.target.value)}
                />
              )}
              {maxHrMode === 'age' && estMaxHr == null && (
                <p className="text-xs text-muted-foreground">
                  Add your birth date above to estimate this, or set it manually.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="resthr">Resting HR (optional)</Label>
              <Input
                id="resthr"
                type="number"
                inputMode="numeric"
                placeholder="e.g. 55"
                value={restingHr}
                onChange={(e) => setRestingHr(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Measure on waking. When set, zones use your reserve (Karvonen)
                for a more personal fit.
              </p>
            </div>

            {hrPreview && (
              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium">Your zones</span>
                  <span className="text-xs text-muted-foreground">
                    {usingKarvonen ? 'Karvonen (reserve)' : '% of max HR'}
                  </span>
                </div>
                <div className="space-y-1">
                  {hrPreview.map((z) => (
                    <div
                      key={z.zone}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: zoneColor(z.zone) }}
                      />
                      <span className="w-5 font-medium">Z{z.zone}</span>
                      <span className="text-muted-foreground">{z.name}</span>
                      <span className="ml-auto tabular-nums">
                        {z.loBpm}–{z.hiBpm} bpm
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={() => setShowHrTips((s) => !s)}
                className="text-xs font-medium text-primary"
              >
                {showHrTips ? 'Hide' : 'How to find these'}
              </button>
              {showHrTips && (
                <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">Max HR</span> —
                    age estimate (default), a field test (progressive hard efforts
                    to all-out, read your peak), the highest your watch has
                    caught, or a lab test.
                  </p>
                  <p>
                    <span className="font-medium text-foreground">
                      Resting HR
                    </span>{' '}
                    — your watch's resting value, or count your pulse for a full
                    minute right after waking.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Weight & goal */}
        <Card>
          <CardHeader>
            <CardTitle>Weight & goal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wt">Current weight (lb)</Label>
              <Input
                id="wt"
                type="number"
                inputMode="decimal"
                placeholder="e.g. 180"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Weekly goal</Label>
              <Select value={rate} onChange={(e) => setRate(e.target.value)}>
                {RATE_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gw">Goal weight (lb, optional)</Label>
              <Input
                id="gw"
                type="number"
                inputMode="decimal"
                placeholder="e.g. 165"
                value={goalWeight}
                onChange={(e) => setGoalWeight(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Calories */}
        <Card>
          <CardHeader>
            <CardTitle>Calorie goal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {goal.calculated != null && (
              <div className="rounded-lg bg-muted p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Maintenance (TDEE)
                  </span>
                  <span className="font-medium">{goal.tdee} calories</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-muted-foreground">Suggested goal</span>
                  <span className="font-medium">{goal.calculated} calories</span>
                </div>
              </div>
            )}
            {adaptive?.enough && adaptiveGoal != null ? (
              <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">From your data</span>
                  <span className="text-xs text-muted-foreground">
                    {adaptive.loggedDays} days ·{' '}
                    {adaptive.trendLbPerWeek != null
                      ? `${adaptive.trendLbPerWeek < 0 ? '−' : '+'}${Math.abs(
                          adaptive.trendLbPerWeek,
                        ).toFixed(1)} lb/wk`
                      : ''}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Maintenance — your data
                  </span>
                  <span className="font-semibold">{adaptive.tdee} calories</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Maintenance — formula
                  </span>
                  <span>{goal.tdee != null ? `${goal.tdee} calories` : '—'}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={applyAdaptive}
                  disabled={updateProfile.isPending}
                >
                  {adaptiveApplied
                    ? 'Applied ✓'
                    : `Set my goal to ${adaptiveGoal.toLocaleString()} calories`}
                </Button>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Maintenance measured from your average intake and real weight
                  trend over {adaptive.spanDays} days. The goal applies your
                  weekly rate to it.
                </p>
              </div>
            ) : (
              adaptive?.reason && (
                <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Adaptive goal:{' '}
                  </span>
                  {adaptive.reason}
                </p>
              )
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--primary)]"
                checked={manualMode}
                onChange={(e) => setManualMode(e.target.checked)}
              />
              Set my calorie target manually
            </label>
            {manualMode && (
              <div className="space-y-1.5">
                <Label htmlFor="mc">Manual calorie target</Label>
                <Input
                  id="mc"
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 2000"
                  value={manualCal}
                  onChange={(e) => setManualCal(e.target.value)}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Macros */}
        <Card>
          <CardHeader>
            <CardTitle>Macro targets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <MacroRow
              label="Protein"
              mode={proteinMode}
              onMode={(m) => setProteinMode(m)}
              value={proteinVal}
              onValue={setProteinVal}
              modes={[
                { v: 'g_per_lb', label: 'g / lb bodyweight' },
                { v: 'g', label: 'grams' },
              ]}
              resolved={macros.protein}
            />
            <MacroRow
              label="Fat"
              mode={fatMode}
              onMode={(m) => setFatMode(m)}
              value={fatVal}
              onValue={setFatVal}
              modes={[
                { v: 'pct', label: '% of calories' },
                { v: 'g', label: 'grams' },
              ]}
              resolved={macros.fat}
            />
            <MacroRow
              label="Carbs"
              mode={carbMode}
              onMode={(m) => setCarbMode(m)}
              value={carbVal}
              onValue={setCarbVal}
              modes={[
                { v: 'remainder', label: 'Remainder' },
                { v: 'pct', label: '% of calories' },
                { v: 'g', label: 'grams' },
              ]}
              resolved={macros.carb}
              hideValue={carbMode === 'remainder'}
            />
            <p className="text-xs text-muted-foreground">
              Protein is anchored in grams so it holds steady when calories
              change; carbs &amp; fat flex with your target.
            </p>
          </CardContent>
        </Card>

        <Button
          className="w-full"
          size="lg"
          onClick={onSave}
          disabled={updateProfile.isPending}
        >
          {updateProfile.isPending ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </Button>

        {/* Daily supplements (self-saving, like the Password card below) */}
        <SupplementsCard />

        {/* Password */}
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Set a password to sign in without the email link. The email link
              still works anytime as a backup.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="pw1">New password</Label>
              <Input
                id="pw1"
                type="password"
                autoComplete="new-password"
                placeholder="At least 6 characters"
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw2">Confirm password</Label>
              <Input
                id="pw2"
                type="password"
                autoComplete="new-password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
              />
            </div>
            {pwStatus === 'error' && (
              <p className="text-sm text-destructive">{pwError}</p>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={updatePassword}
              disabled={pwStatus === 'saving' || !pw1 || !pw2}
            >
              {pwStatus === 'saving'
                ? 'Saving…'
                : pwStatus === 'saved'
                  ? 'Password updated ✓'
                  : 'Update password'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MacroRow({
  label,
  mode,
  onMode,
  value,
  onValue,
  modes,
  resolved,
  hideValue,
}: {
  label: string
  mode: MacroMode
  onMode: (m: MacroMode) => void
  value: string
  onValue: (v: string) => void
  modes: { v: MacroMode; label: string }[]
  resolved: { grams: number; pct: number }
  hideValue?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-sm font-semibold">
          {resolved.grams} g · {resolved.pct}%
        </span>
      </div>
      <div className="flex gap-2">
        <Select
          className="flex-1"
          value={mode}
          onChange={(e) => onMode(e.target.value as MacroMode)}
        >
          {modes.map((m) => (
            <option key={m.v} value={m.v}>
              {m.label}
            </option>
          ))}
        </Select>
        {!hideValue && (
          <Input
            className="w-24"
            type="number"
            inputMode="decimal"
            value={value}
            onChange={(e) => onValue(e.target.value)}
          />
        )}
      </div>
    </div>
  )
}

// A multivitamin / supplement taken every day. Self-saving (each add/remove/dose
// change persists immediately); its micros feed the weekly Micronutrients card.
function SupplementsCard() {
  const { data: profile } = useProfile()
  const updateProfile = useUpdateProfile()
  const { supplements } = useDailySupplements()
  const [search, setSearch] = useState('')
  const { data: results } = useFoods(search)

  const raw: DailySupplement[] = profile?.daily_supplements ?? []
  const persist = (next: DailySupplement[]) =>
    updateProfile.mutate({ daily_supplements: next })

  const add = (foodId: string) => {
    if (raw.some((s) => s.food_id === foodId)) return
    persist([...raw, { food_id: foodId, servings: 1 }])
    setSearch('')
  }
  const remove = (foodId: string) =>
    persist(raw.filter((s) => s.food_id !== foodId))
  const setServings = (foodId: string, servings: number) =>
    persist(raw.map((s) => (s.food_id === foodId ? { ...s, servings } : s)))

  const addedIds = new Set(raw.map((s) => s.food_id))
  const matches = (results ?? [])
    .filter((f) => !addedIds.has(f.id))
    .slice(0, 6)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily supplements</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          A multivitamin or supplement you take every day. Its micronutrients are
          added to every logged day in your weekly Micronutrients summary
          (Progress → Nutrition). It isn&rsquo;t logged to your diary, and changes
          here save on their own.
        </p>

        {supplements.length > 0 && (
          <ul className="space-y-2">
            {supplements.map((s) => (
              <li
                key={s.food_id}
                className="flex items-center gap-2 rounded-lg border border-border p-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.food.name}</p>
                  {s.food.brand && (
                    <p className="truncate text-xs text-muted-foreground">
                      {s.food.brand}
                    </p>
                  )}
                </div>
                <ServingsInput
                  value={s.servings}
                  unit={s.food.serving_unit}
                  onCommit={(v) => setServings(s.food_id, v)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${s.food.name}`}
                  onClick={() => remove(s.food_id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="supp-search">Add a supplement</Label>
          <Input
            id="supp-search"
            placeholder="Search your foods…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search.trim() &&
            (matches.length > 0 ? (
              <ul className="overflow-hidden rounded-lg border border-border">
                {matches.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => add(f.id)}
                      className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
                    >
                      <Plus className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      {f.brand && (
                        <span className="shrink-0 truncate text-xs text-muted-foreground">
                          {f.brand}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                No matches. Create the supplement as a food first (add it from the
                Diary), then search for it here.
              </p>
            ))}
        </div>
      </CardContent>
    </Card>
  )
}

// Compact servings field that commits on blur / Enter (not per keystroke, so it
// doesn't fire a save on every digit).
function ServingsInput({
  value,
  unit,
  onCommit,
}: {
  value: number
  unit: string
  onCommit: (v: number) => void
}) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  const commit = () => {
    const n = parseFloat(v)
    if (!isNaN(n) && n > 0 && n !== value) onCommit(n)
    else setV(String(value))
  }
  return (
    <div className="flex items-center gap-1">
      <Input
        className="w-14 text-center"
        type="number"
        inputMode="decimal"
        value={v}
        aria-label="Servings per day"
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      <span className="w-10 shrink-0 truncate text-xs text-muted-foreground">
        {unit}
      </span>
    </div>
  )
}
