import fs from 'node:fs'

// USDA FDC nutrient number -> FitLog key (mirror of src/lib/nutrients.ts)
const USDA_TO_KEY = {
  1008:'kcal',1003:'protein',1005:'carb',1004:'fat',1079:'fiber',2000:'sugar',
  1235:'added_sugar',1258:'sat_fat',1257:'trans_fat',1253:'cholesterol',1093:'sodium',
  1092:'potassium',1087:'calcium',1089:'iron',1090:'magnesium',1091:'phosphorus',
  1095:'zinc',1098:'copper',1101:'manganese',1103:'selenium',1106:'vit_a',1162:'vit_c',
  1114:'vit_d',1109:'vit_e',1185:'vit_k',1165:'b1',1166:'b2',1167:'b3',1175:'b6',
  1190:'folate',1178:'b12',
}
const ENERGY_FALLBACK = [2047, 2048]

function getKey() {
  try {
    const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
    const m = env.match(/VITE_USDA_API_KEY\s*=\s*(.+)/)
    if (m) return m[1].trim()
  } catch {}
  return 'DEMO_KEY'
}
const KEY = getKey()
const API = 'https://api.nal.usda.gov/fdc/v1'

function mapNutrients(list) {
  const out = {}
  for (const fn of list || []) {
    const id = fn.nutrientId ?? fn.nutrient?.id
    const val = fn.value ?? fn.amount
    if (id == null || val == null) continue
    const k = USDA_TO_KEY[id]
    if (k) out[k] = val
  }
  if (out.kcal == null) {
    for (const a of ENERGY_FALLBACK) {
      const fn = (list || []).find(
        (n) => (n.nutrientId ?? n.nutrient?.id) === a && (n.value ?? n.amount) != null,
      )
      if (fn) { out.kcal = fn.value ?? fn.amount; break }
    }
  }
  return out
}

async function search(q, types) {
  const url = `${API}/foods/search?api_key=${KEY}&query=${encodeURIComponent(q)}&pageSize=4&dataType=${encodeURIComponent(types)}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${q} -> ${r.status}`)
  const d = await r.json()
  return d.foods || []
}

const SERVINGS = 4
const ingredients = [
  { name: 'All-purpose flour',  q: 'Flour, wheat, all-purpose, enriched, bleached', types: 'SR Legacy,Foundation', grams: 135 },
  { name: 'Vital Wheat Gluten', q: 'Vital wheat gluten',                              types: 'SR Legacy,Foundation,Branded', grams: 85 },
  { name: 'Honey',              q: 'Honey',                                            types: 'SR Legacy,Foundation', grams: 9 },
  { name: 'Nutritional Yeast',  q: 'Nutritional yeast',                                types: 'Branded,SR Legacy,Foundation', grams: 5 },
  { name: 'Vinegar',            q: 'Vinegar, distilled',                               types: 'SR Legacy,Foundation', grams: 5 },
]

const perIng = []
for (const ing of ingredients) {
  const foods = await search(ing.q, ing.types)
  const pick = foods[0]
  if (!pick) { console.log(`NO MATCH: ${ing.name}`); continue }
  const n100 = mapNutrients(pick.foodNutrients)
  perIng.push({ ...ing, fdcId: pick.fdcId, desc: pick.description, dataType: pick.dataType, n100 })
  console.log(`\n${ing.name}  @ ${ing.grams} g`)
  console.log(`  -> [${pick.dataType}] ${pick.description} (fdc ${pick.fdcId})`)
  console.log(`  per100g: kcal ${n100.kcal} | P ${n100.protein} C ${n100.carb} F ${n100.fat}`)
}

const total = {}
for (const ing of perIng) {
  const f = ing.grams / 100
  for (const k in ing.n100) total[k] = (total[k] || 0) + ing.n100[k] * f
}
const per = {}
for (const k in total) per[k] = +(total[k] / SERVINGS).toFixed(2)

console.log(`\n=== PER SERVING (recipe yields ${SERVINGS}) ===`)
console.log(JSON.stringify(per, null, 0))
console.log(`\nkcal/serving: ${per.kcal}   (MFP screenshot: 214)`)
console.log(`P/C/F per serving: ${per.protein} / ${per.carb} / ${per.fat} g   (MFP: 20 / 31 / 1)`)

// ---- emit ready-to-run SQL for the Supabase SQL Editor ----
const esc = (s) => s.replace(/'/g, "''")
const j = (o) => `'${JSON.stringify(o)}'::jsonb`
const EMAIL = '<<YOUR FITLOG LOGIN EMAIL>>'
const ingValues = perIng
  .map((i) => `    ((select uid from me), '${esc(i.desc)}', 'usda', '${i.fdcId}', 100, 'g', 100, ${j(i.n100)})`)
  .join(',\n')
const links = perIng.map((i) => `    when '${i.fdcId}' then ${+(i.grams / 100).toFixed(4)}`).join('\n')
const sql = `-- Homemade Bagels -> FitLog. Run in Supabase SQL Editor.
-- STEP 1: put your FitLog login email between the quotes below.
with me as (
  select id as uid from auth.users where email = '${EMAIL}'
),
ing as (
  insert into public.foods
    (user_id, name, source, source_id, serving_qty, serving_unit, serving_grams, nutrients)
  values
${ingValues}
  returning id, source_id
),
recipe as (
  insert into public.foods
    (user_id, name, source, recipe_servings, serving_qty, serving_unit, nutrients)
  values ((select uid from me), 'Homemade Bagels', 'recipe', ${SERVINGS}, 1, 'serving', ${j(per)})
  returning id
)
insert into public.recipe_ingredients (user_id, recipe_food_id, ingredient_food_id, servings)
select (select uid from me), (select id from recipe), ing.id,
  case ing.source_id
${links}
  end
from ing;
`
fs.writeFileSync(new URL('./homemade-bagels.sql', import.meta.url), sql)
console.log('\nWrote scripts/homemade-bagels.sql')
