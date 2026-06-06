import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useProfile, useUpdateProfile } from '@/features/profile/useProfile'
import {
  useLatestWeight,
  useLogMeasurement,
} from '@/features/measurements/useMeasurements'
import {
  ACTIVITY_LABELS,
  cmToFtIn,
  ftInToCm,
  resolveCalorieGoal,
  resolveMacroTargets,
} from '@/lib/calc'
import { todayISO } from '@/lib/date'
import type {
  ActivityLevel,
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
  const updateProfile = useUpdateProfile()
  const logWeight = useLogMeasurement()

  const [sex, setSex] = useState<Sex | ''>('')
  const [birthDate, setBirthDate] = useState('')
  const [ft, setFt] = useState('')
  const [inch, setInch] = useState('')
  const [activity, setActivity] = useState<ActivityLevel>('moderate')
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
      macro_targets: macroTargets,
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
              <span className="ml-1 text-base font-medium opacity-80">kcal</span>
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
                  <span className="font-medium">{goal.tdee} kcal</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-muted-foreground">Suggested goal</span>
                  <span className="font-medium">{goal.calculated} kcal</span>
                </div>
              </div>
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
