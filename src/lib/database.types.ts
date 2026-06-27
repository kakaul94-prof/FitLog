// Canonical nutrient codes stored in foods.nutrients / diary_entries.nutrients.
// Amounts are per single serving. Units: kcal in kcal; macros/fiber/sugar in g;
// cholesterol/sodium/minerals in mg; vitamins in their DV units (see nutrients.ts).
export const NUTRIENT_KEYS = [
  'kcal',
  'protein',
  'carb',
  'fat',
  'fiber',
  'sugar',
  'added_sugar',
  'sat_fat',
  'trans_fat',
  'cholesterol',
  'sodium',
  'potassium',
  'calcium',
  'iron',
  'magnesium',
  'phosphorus',
  'zinc',
  'copper',
  'manganese',
  'selenium',
  'vit_a',
  'vit_c',
  'vit_d',
  'vit_e',
  'vit_k',
  'b1',
  'b2',
  'b3',
  'b6',
  'folate',
  'b12',
] as const

export type NutrientKey = (typeof NUTRIENT_KEYS)[number]
export type Nutrients = Partial<Record<NutrientKey, number>>

export type Sex = 'male' | 'female'
export type ActivityLevel =
  | 'sedentary'
  | 'light'
  | 'moderate'
  | 'active'
  | 'very_active'
export type GoalType = 'lose' | 'maintain' | 'gain'
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snacks'
export type FoodSource = 'usda' | 'manual' | 'recipe'
export type ExerciseType = 'weighted' | 'bodyweight' | 'timed' | 'cardio'
// Progression style for a strength goal (see src/lib/progression.ts).
export type ProgressionMethod = 'linear' | 'double' | '531'

export type MacroMode = 'g' | 'g_per_lb' | 'pct' | 'remainder'
export interface MacroTarget {
  mode: MacroMode
  value?: number
}
export interface MacroTargets {
  protein: MacroTarget
  carb: MacroTarget
  fat: MacroTarget
}

export interface Profile {
  id: string
  sex: Sex | null
  birth_date: string | null
  height_cm: number | null
  activity_level: ActivityLevel
  weight_unit: string
  distance_unit: string
  goal_type: GoalType
  goal_rate_lb_per_week: number
  goal_weight_lb: number | null
  calorie_goal_mode: 'calculated' | 'manual'
  manual_calorie_goal: number | null
  macro_targets: MacroTargets
  // Per-muscle weekly set goals (sets/week), keyed by RegionId from bodyMap.
  // Sparse/nullable; missing regions fall back to DEFAULT_GOALS. 0 = untracked.
  volume_targets: Record<string, number> | null
  eat_back_exercise: boolean
  created_at: string
  updated_at: string
}

// An alternate serving unit for a food (e.g. "1 cup = 240 g"). Nutrition
// auto-scales from the food's base per-gram unless `nutrients` overrides it.
export interface Portion {
  id: string
  label: string
  grams: number | null
  nutrients?: Nutrients
}

export interface Food {
  id: string
  user_id: string
  name: string
  brand: string | null
  source: FoodSource
  source_id: string | null
  serving_qty: number
  serving_unit: string
  serving_grams: number | null
  recipe_servings: number | null
  nutrients: Nutrients
  portions: Portion[]
  archived: boolean
  created_at: string
  updated_at: string
}

export interface RecipeIngredient {
  id: string
  user_id: string
  recipe_food_id: string
  ingredient_food_id: string
  // amount of `unit` ('base' = a base serving, a portion id, or g/oz/lb).
  // `servings` is the derived base-serving multiplier (legacy / convenience).
  amount: number | null
  unit: string | null
  servings: number
  position: number
  created_at: string
}

export interface DiaryEntry {
  id: string
  user_id: string
  entry_date: string
  meal: Meal
  food_id: string | null
  food_name: string
  brand: string | null
  servings: number
  serving_qty: number | null
  serving_unit: string | null
  nutrients: Nutrients
  position: number
  created_at: string
}

// A named, reusable bundle of foods. Logging it creates one diary
// row per item (each stays individually editable), unlike a recipe.
export interface SavedMeal {
  id: string
  user_id: string
  name: string
  position: number
  created_at: string
  updated_at: string
}

// One food in a saved meal. Snapshots the food (same shape as a
// diary row) so logging stays stable if the source food changes.
export interface SavedMealItem {
  id: string
  user_id: string
  meal_id: string
  food_id: string | null
  food_name: string
  brand: string | null
  servings: number
  serving_qty: number | null
  serving_unit: string | null
  nutrients: Nutrients
  position: number
  created_at: string
}

export interface CustomActivity {
  id: string
  user_id: string
  name: string
  met: number
  distance_based: boolean
  created_at: string
}

export interface ExerciseEntry {
  id: string
  user_id: string
  entry_date: string
  name: string
  met: number | null
  duration_min: number | null
  distance_mi: number | null
  calories: number
  created_at: string
}

export interface CustomExercise {
  id: string
  user_id: string
  name: string
  muscle: string | null
  equipment: string | null
  type: ExerciseType
  created_at: string
}

// Per-user form notes for one exercise (built-in slug or 'custom:<uuid>').
// Curated cues ship in src/data/exerciseForm.ts; this holds the user's own.
export interface ExerciseNote {
  id: string
  user_id: string
  exercise_key: string
  notes: string | null
  // Exact curated-cue strings the user has hidden for this exercise.
  hidden_cues: string[]
  // Exact curated-cue strings the user has starred as especially helpful.
  starred_cues: string[]
  created_at: string
  updated_at: string
}

// Per-user form-check video for one exercise (built-in slug or 'custom:<uuid>').
// "Keep last 1": one row per user per exercise; recording a new clip replaces
// it. The file lives in the private 'form-videos' Storage bucket at storage_path.
export interface FormVideo {
  id: string
  user_id: string
  exercise_key: string
  storage_path: string
  duration_sec: number | null
  size_bytes: number | null
  created_at: string
}

export interface Routine {
  id: string
  user_id: string
  name: string
  position: number
  created_at: string
  updated_at: string
}

export interface RoutineExercise {
  id: string
  user_id: string
  routine_id: string
  exercise_key: string
  exercise_name: string
  position: number
  target_sets: number | null
  target_reps: number | null
  superset_group: number | null
}

export interface Workout {
  id: string
  user_id: string
  workout_date: string
  name: string | null
  source_routine_id: string | null
  notes: string | null
  rest_seconds: number
  completed: boolean
  created_at: string
}

export interface WorkoutExercise {
  id: string
  user_id: string
  workout_id: string
  exercise_key: string
  exercise_name: string
  position: number
  notes: string | null
  superset_group: number | null
  // Wall-clock timing for the whole exercise: Start stamps when you begin the
  // first set, Done stamps the end. ended_at non-null = the exercise is done.
  started_at: string | null
  ended_at: string | null
  created_at: string
}

export interface WorkoutSet {
  id: string
  user_id: string
  workout_id: string
  workout_exercise_id: string | null
  exercise_key: string
  exercise_name: string
  set_number: number
  reps: number | null
  weight_lb: number | null
  duration_sec: number | null
  distance: number | null
  effort: number | null
  is_warmup: boolean
  created_at: string
}

export interface Measurement {
  id: string
  user_id: string
  measured_on: string
  type: string
  value: number
  unit: string
  created_at: string
}

// Per-exercise strength goal (target 1RM) + progression state. The app suggests
// the next session toward target_1rm_lb via `method`. Current strength is
// derived live from workout_sets (not stored), so switching method never resets.
// tm_lb/cycle/week hold 5/3/1 state only (ignored by the other methods).
export interface StrengthGoal {
  id: string
  user_id: string
  exercise_key: string
  exercise_name: string
  target_1rm_lb: number
  method: ProgressionMethod
  increment_lb: number | null
  rep_low: number
  rep_high: number
  sets: number
  tm_lb: number | null
  cycle: number
  week: number
  achieved_at: string | null
  target_date: string | null
  created_at: string
  updated_at: string
}

// Shape Supabase's typed client expects per table.
type Tbl<Row> = {
  Row: Row
  Insert: Partial<Row>
  Update: Partial<Row>
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      profiles: Tbl<Profile>
      foods: Tbl<Food>
      recipe_ingredients: Tbl<RecipeIngredient>
      diary_entries: Tbl<DiaryEntry>
      meals: Tbl<SavedMeal>
      meal_items: Tbl<SavedMealItem>
      custom_activities: Tbl<CustomActivity>
      exercise_entries: Tbl<ExerciseEntry>
      custom_exercises: Tbl<CustomExercise>
      exercise_notes: Tbl<ExerciseNote>
      form_videos: Tbl<FormVideo>
      routines: Tbl<Routine>
      routine_exercises: Tbl<RoutineExercise>
      workouts: Tbl<Workout>
      workout_exercises: Tbl<WorkoutExercise>
      workout_sets: Tbl<WorkoutSet>
      measurements: Tbl<Measurement>
      strength_goals: Tbl<StrengthGoal>
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
