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
  created_at: string
  updated_at: string
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
      routines: Tbl<Routine>
      routine_exercises: Tbl<RoutineExercise>
      workouts: Tbl<Workout>
      workout_exercises: Tbl<WorkoutExercise>
      workout_sets: Tbl<WorkoutSet>
      measurements: Tbl<Measurement>
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
