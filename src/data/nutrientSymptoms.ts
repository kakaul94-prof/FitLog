import type { NutrientKey } from '@/lib/database.types'

// What a sustained shortfall (floor nutrients) or excess (limit nutrients) can
// feel like, shown in Progress → Nutrition's Weekly/Monthly report next to each
// flagged nutrient. Hedged wording on purpose — this is general information,
// not medical advice, and the card says so. One full sentence per nutrient that
// useMicronutrientTrends can flag (direction + DV in nutrients.ts) — rendered
// as-is, so each reads on its own.
export const NUTRIENT_SYMPTOMS: Partial<Record<NutrientKey, string>> = {
  // Floors — what running low can look like
  fiber:
    'May show up as constipation, irregular digestion, or hunger returning soon after meals.',
  potassium:
    'May show up as muscle weakness, cramps, or an irregular heartbeat.',
  calcium:
    'Few early signs — over time, low intake means weaker bones and more fracture risk.',
  iron: 'May show up as tiredness, breathlessness on stairs, pale skin, or cold hands.',
  magnesium:
    'May show up as muscle cramps, twitching, fatigue, or restless sleep.',
  phosphorus: 'May show up as bone aches, muscle weakness, or low appetite.',
  zinc: 'May show up as slower wound healing, frequent colds, or a dulled sense of taste.',
  copper: 'May show up as fatigue, easy bruising, or weak, brittle bones.',
  manganese:
    'Few clear signs — long-term shortfalls affect bone and joint health.',
  selenium: 'May show up as fatigue, muscle weakness, or thinning hair.',
  vit_a: 'May show up as trouble seeing in dim light, dry eyes, or dry skin.',
  vit_c: 'May show up as bleeding gums, easy bruising, or cuts healing slowly.',
  vit_d: 'May show up as fatigue, low mood, or bone and muscle aches.',
  vit_e: 'May show up as muscle weakness or numbness and tingling in hands and feet.',
  vit_k: 'May show up as easy bruising or cuts that are slow to stop bleeding.',
  b1: 'May show up as fatigue, irritability, poor appetite, or heavy legs.',
  b2: 'May show up as cracks at the corners of the mouth, a sore tongue, or sore throat.',
  b3: 'May show up as fatigue, a rash on sun-exposed skin, or digestive upset.',
  b6: 'May show up as low mood, irritability, a sore tongue, or a rash.',
  folate: 'May show up as fatigue, mouth sores, or irritability.',
  b12: 'May show up as fatigue, brain fog, or tingling in the hands and feet.',
  // Limits — what running over can look like
  sodium:
    'May show up as bloating, water retention, thirst, or higher blood pressure.',
  sat_fat: 'No day-to-day symptoms — linked to raised LDL cholesterol over time.',
  added_sugar:
    'May show up as energy crashes, stronger cravings, and easier weight gain over time.',
  cholesterol:
    'No day-to-day symptoms — may nudge blood cholesterol up in some people.',
}
