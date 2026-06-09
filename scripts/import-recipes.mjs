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
      const fn = (list || []).find((n) => (n.nutrientId ?? n.nutrient?.id) === a && (n.value ?? n.amount) != null)
      if (fn) { out.kcal = fn.value ?? fn.amount; break }
    }
  }
  return out
}

async function searchFirst(q, types) {
  // USDA search uses Lucene syntax; strip parens/brackets/quotes or it 400s.
  const safe = q.replace(/\([^)]*\)/g, ' ').replace(/[()[\]{}"]/g, ' ').replace(/\s+/g, ' ').trim()
  const url = `${API}/foods/search?api_key=${KEY}&query=${encodeURIComponent(safe)}&pageSize=2&dataType=${encodeURIComponent(types || 'SR Legacy,Foundation,Branded')}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`search "${safe}" -> ${r.status}`)
  const f = ((await r.json()).foods || [])[0]
  if (!f) return null
  return { fdcId: f.fdcId, desc: f.description, dataType: f.dataType, n100: mapNutrients(f.foodNutrients) }
}
async function byFdc(fdc) {
  const r = await fetch(`${API}/food/${fdc}?api_key=${KEY}`)
  if (!r.ok) throw new Error(`fdc ${fdc} -> ${r.status}`)
  const f = await r.json()
  return { fdcId: f.fdcId, desc: f.description, dataType: f.dataType, n100: mapNutrients(f.foodNutrients) }
}

// grams = the amount used in the whole recipe (all servings). label = my note on the conversion.
const recipes = [
  { name: 'Ninja Creami - Vanilla', servings: 1, mfp: { kcal: 373, protein: 27, carb: 17, fat: 20 }, ingredients: [
    { q: 'Sugars, granulated', grams: 4, label: '1 tsp sugar (reuse)' },
    { q: 'Vanilla extract', grams: 5, label: '5 g vanilla extract' },
    { q: 'Egg, yolk, raw, fresh', grams: 17, label: '1 egg yolk' },
    { q: 'Erythritol', grams: 4, label: '1 tsp erythritol (may not resolve)' },
    { q: 'Milk, whole, 3.25% milkfat, with added vitamin D', grams: 464, label: '15.2 fl oz Fairlife whole milk (proxy, reuse)' },
  ]},
  { name: 'Protein Pumpkin Muffin', servings: 6, mfp: { kcal: 249, protein: 18, carb: 25, fat: 7 }, ingredients: [
    { q: 'Pumpkin, canned, without salt', grams: 425, label: '1 can pumpkin (~15 oz)' },
    { q: 'Cheese, cottage, lowfat, 2% milkfat', grams: 90, label: '90 g cottage cheese 2%' },
    { q: 'Flour, wheat, all-purpose, enriched, bleached', grams: 90, label: '90 g all-purpose flour (reuse)' },
    { q: 'Whey protein powder', types: 'Branded', grams: 102, label: '102 g vanilla protein' },
    { q: 'Sugars, granulated', grams: 40, label: '40 g sugar (reuse)' },
    { q: 'Oil, olive, salad or cooking', grams: 27, label: '2 tbsp olive oil (reuse)' },
    { q: 'Cheese, cream, reduced fat', grams: 90, label: '90 g reduced-fat cream cheese' },
    { q: 'Egg, whole, raw, fresh', grams: 100, label: '2 large eggs (reuse)' },
  ]},
  { name: 'Protein Baguette', servings: 1, mfp: { kcal: 316, protein: 19, carb: 55, fat: 1 }, ingredients: [
    { q: 'Flour, wheat, all-purpose, enriched, bleached', grams: 75, label: '75 g flour (reuse)' },
    { q: 'Vital wheat gluten', grams: 12.5, label: '12.5 g vital wheat gluten (reuse)' },
  ]},
  { name: 'Homemade Sliced Bread', servings: 19, mfp: { kcal: 77, protein: 7, carb: 10, fat: 1 }, ingredients: [
    { q: 'Wheat flour, white, bread, enriched', grams: 220, label: '220 g bread flour' },
    { q: 'Dough conditioner', types: 'Branded', grams: 15, label: '15 g dough conditioner (may not resolve)' },
    { q: 'Milk, whole, 3.25% milkfat, with added vitamin D', grams: 290, label: '9.5 fl oz Mootopia whole milk (proxy, reuse)' },
    { q: 'Leavening agents, yeast, bakers, active dry', grams: 10, label: '10 g instant yeast' },
    { q: 'Vital wheat gluten', grams: 110, label: '110 g vital wheat gluten (reuse)' },
  ]},
  { name: 'Protein Rotis', servings: 5, mfp: { kcal: 132, protein: 12, carb: 20, fat: 2 }, ingredients: [
    { q: 'Vital wheat gluten', grams: 60, label: '60 g vital wheat gluten (reuse)' },
    { q: 'Wheat flour, whole grain', grams: 120, label: '120 g whole wheat flour' },
  ]},
]

// ---- resolve every ingredient (cache by fdc or query) ----
const cache = new Map()
async function resolve(ing) {
  const key = ing.fdc ? `fdc:${ing.fdc}` : `q:${ing.q}|${ing.types || ''}`
  if (!cache.has(key)) cache.set(key, ing.fdc ? await byFdc(ing.fdc) : await searchFirst(ing.q, ing.types))
  return cache.get(key)
}

const NUM = (n) => Math.round(n * 100) / 100
const pctOff = (got, want) => (want ? Math.round(((got - want) / want) * 100) : 0)

for (const r of recipes) {
  for (const ing of r.ingredients) ing._res = await resolve(ing)
}

// ---- verify each recipe against MFP ----
console.log('RECIPE VERIFICATION (computed per serving vs MFP screenshot)\n')
for (const r of recipes) {
  const total = {}
  for (const ing of r.ingredients) {
    if (!ing._res) { console.log(`  !! NO MATCH: ${r.name} / ${ing.label}`); continue }
    const f = ing.grams / 100
    for (const k in ing._res.n100) total[k] = (total[k] || 0) + ing._res.n100[k] * f
  }
  const per = {}
  for (const k in total) per[k] = NUM(total[k] / r.servings)
  r._per = per
  const tag = (got, want) => `${NUM(got ?? 0)} vs ${want} (${pctOff(got ?? 0, want) >= 0 ? '+' : ''}${pctOff(got ?? 0, want)}%)`
  console.log(`■ ${r.name}  [yield ${r.servings}]`)
  console.log(`    kcal ${tag(per.kcal, r.mfp.kcal)} | P ${tag(per.protein, r.mfp.protein)} | C ${tag(per.carb, r.mfp.carb)} | F ${tag(per.fat, r.mfp.fat)}`)
}

// ---- resolved USDA picks (eyeball check) ----
console.log('\nRESOLVED USDA PICKS\n')
for (const r of recipes) {
  console.log(`■ ${r.name}`)
  for (const ing of r.ingredients) {
    const x = ing._res
    console.log(`    ${ing.label}\n        -> ${x ? `[${x.dataType}] ${x.desc} (fdc ${x.fdcId}, ${x.n100.kcal} kcal/100g)` : 'NO MATCH'}`)
  }
}

// ---- emit combined SQL ----
const esc = (s) => String(s).replace(/'/g, "''")
const j = (o) => `'${JSON.stringify(o)}'::jsonb`
const EMAIL = '<<YOUR FITLOG LOGIN EMAIL>>'

const uniq = new Map() // fdcId -> {desc, n100}
for (const r of recipes) for (const ing of r.ingredients) if (ing._res) uniq.set(ing._res.fdcId, ing._res)

const ingValues = [...uniq.values()]
  .map((x) => `      ('${x.fdcId}', '${esc(x.desc)}', ${j(x.n100)})`)
  .join(',\n')

// Exact MFP per-serving panels from the screenshots. %DV figures (calcium/iron/
// vitamins) converted to absolute via FitLog DV table (Ca 1300mg, Fe 18mg, A 900mcg, C 90mg).
const STORE = {
  'Ninja Creami - Vanilla': { kcal:373, protein:27, carb:17, fat:20, fiber:0, sugar:16, sat_fat:11, trans_fat:0, cholesterol:241, sodium:259, potassium:786, calcium:780, iron:0.54, vit_a:252, vit_c:0 },
  'Protein Pumpkin Muffin': { kcal:249, protein:18, carb:25, fat:7, fiber:0, sugar:10, sat_fat:2, trans_fat:0, cholesterol:66, sodium:90, potassium:57, calcium:39, iron:1.08, vit_a:306, vit_c:0.9 },
  'Protein Baguette': { kcal:316, protein:19, carb:55, fat:1, fiber:0, sugar:0, sat_fat:0, trans_fat:0, cholesterol:0, sodium:4, potassium:13, calcium:26, iron:0.72, vit_a:0, vit_c:0 },
  'Homemade Sliced Bread': { kcal:77, protein:7, carb:10, fat:1, fiber:1, sugar:0, sat_fat:0, trans_fat:0, cholesterol:2, sodium:18, potassium:33, calcium:39, iron:0.9, vit_a:0, vit_c:0.9 },
  'Protein Rotis': { kcal:132, protein:12, carb:20, fat:2, fiber:2, sugar:0, sat_fat:0, trans_fat:0, cholesterol:0, sodium:3, potassium:12, calcium:26, iron:0.54, vit_a:0, vit_c:0 },
}

const recipeValues = recipes
  .map((r) => `    ((select uid from me), '${esc(r.name)}', 'recipe', ${r.servings}, 1, 'serving', ${j(STORE[r.name])})`)
  .join(',\n')

const linkValues = []
for (const r of recipes)
  for (const ing of r.ingredients)
    if (ing._res) linkValues.push(`    ('${esc(r.name)}', '${ing._res.fdcId}', ${NUM(ing.grams / 100)})`)

const sql = `-- MyFitnessPal recipes -> FitLog. Run once in the Supabase SQL Editor.
-- STEP 1: put your FitLog login email between the quotes below, then Run.
with me as (
  select id as uid from auth.users where email = '${EMAIL}'
),
new_ing as (
  insert into public.foods (user_id, name, source, source_id, serving_qty, serving_unit, serving_grams, nutrients)
  select (select uid from me), v.name, 'usda', v.source_id, 100, 'g', 100, v.nutrients
  from (values
${ingValues}
  ) as v(source_id, name, nutrients)
  where not exists (
    select 1 from public.foods f
    where f.user_id = (select uid from me) and f.source = 'usda' and f.source_id = v.source_id
  )
  returning id, source_id
),
ing as (
  select id, source_id from new_ing
  union
  select id, source_id from public.foods
  where user_id = (select uid from me) and source = 'usda'
    and source_id in (${[...uniq.keys()].map((k) => `'${k}'`).join(', ')})
),
recipes as (
  insert into public.foods (user_id, name, source, recipe_servings, serving_qty, serving_unit, nutrients)
  values
${recipeValues}
  returning id, name
)
insert into public.recipe_ingredients (user_id, recipe_food_id, ingredient_food_id, servings)
select (select uid from me), r.id, i.id, li.servings
from (values
${linkValues.join(',\n')}
) as li(recipe_name, source_id, servings)
join recipes r on r.name = li.recipe_name
join ing i on i.source_id = li.source_id;
`
fs.writeFileSync(new URL('./mfp-recipes-3.sql', import.meta.url), sql)
console.log('\nWrote scripts/mfp-recipes-3.sql')
