import type { NutrientKey } from '@/lib/database.types'

// Common, readily-available food sources for each floor micronutrient, used by
// the Progress → Nutrition "food sources for what you're low on" suggestions.
// Hand-curated toward everyday grocery items (not organ meats / exotic foods),
// 4–5 per nutrient. Only floors have entries — limits (sodium, added sugar…)
// are things to eat LESS of, so they get no sources. Mirrors the app's other
// curated data files (exerciseForm.ts, activities.ts).
export const NUTRIENT_SOURCES: Partial<Record<NutrientKey, string[]>> = {
  fiber: ['beans', 'oats', 'raspberries', 'lentils', 'whole grains'],
  potassium: ['bananas', 'potatoes', 'spinach', 'beans', 'yogurt'],
  calcium: ['milk', 'yogurt', 'cheese', 'fortified tofu', 'kale'],
  iron: ['red meat', 'lentils', 'spinach', 'tofu', 'fortified cereal'],
  magnesium: ['pumpkin seeds', 'almonds', 'black beans', 'spinach', 'dark chocolate'],
  phosphorus: ['dairy', 'chicken', 'fish', 'nuts', 'whole grains'],
  zinc: ['beef', 'pumpkin seeds', 'chickpeas', 'cashews', 'yogurt'],
  copper: ['cashews', 'sunflower seeds', 'dark chocolate', 'chickpeas', 'mushrooms'],
  manganese: ['oats', 'brown rice', 'chickpeas', 'almonds', 'pineapple'],
  selenium: ['tuna', 'eggs', 'brown rice', 'sunflower seeds', 'chicken'],
  vit_a: ['sweet potato', 'carrots', 'spinach', 'eggs', 'cantaloupe'],
  vit_c: ['oranges', 'bell peppers', 'strawberries', 'broccoli', 'kiwi'],
  vit_d: ['salmon', 'fortified milk', 'eggs', 'tuna', 'fortified cereal'],
  vit_e: ['almonds', 'sunflower seeds', 'avocado', 'peanut butter', 'spinach'],
  vit_k: ['kale', 'spinach', 'broccoli', 'Brussels sprouts', 'lettuce'],
  b1: ['pork', 'black beans', 'sunflower seeds', 'whole grains', 'fortified cereal'],
  b2: ['milk', 'eggs', 'yogurt', 'almonds', 'mushrooms'],
  b3: ['chicken', 'tuna', 'turkey', 'peanuts', 'brown rice'],
  b6: ['chicken', 'bananas', 'chickpeas', 'potatoes', 'fortified cereal'],
  folate: ['lentils', 'spinach', 'asparagus', 'avocado', 'fortified cereal'],
  b12: ['beef', 'salmon', 'eggs', 'dairy', 'fortified cereal'],
}
