-- Homemade Bagels -> FitLog. Run in Supabase SQL Editor.
-- STEP 1: put your FitLog login email between the quotes below.
with me as (
  select id as uid from auth.users where email = '<<soccernerd05@gmail.com>>'
),
ing as (
  insert into public.foods
    (user_id, name, source, source_id, serving_qty, serving_unit, serving_grams, nutrients)
  values
    ((select uid from me), 'Flour, wheat, all-purpose, enriched, bleached', 'usda', '789890', 100, 'g', 100, '{"iron":5.62,"magnesium":26.7,"phosphorus":108,"sodium":2,"copper":0.155,"manganese":0.758,"protein":10.9,"b1":0.939,"b2":0.443,"fat":1.48,"carb":77.3,"kcal":366,"calcium":19,"potassium":136,"zinc":0.72,"b3":6.74,"b6":0.066,"selenium":15.7}'::jsonb),
    ((select uid from me), 'Vital wheat gluten', 'usda', '168147', 100, 'g', 100, '{"protein":75.2,"fiber":0.6,"iron":5.2,"magnesium":25,"phosphorus":260,"sodium":29,"copper":0.182,"vit_a":0,"sat_fat":0.272,"vit_k":0,"vit_c":0,"b1":0,"b2":0,"fat":1.85,"carb":13.8,"kcal":370,"sugar":0,"calcium":142,"potassium":100,"zinc":0.85,"selenium":39.7,"vit_e":0,"b3":0,"folate":0,"b6":0,"cholesterol":0,"b12":0,"vit_d":0}'::jsonb),
    ((select uid from me), 'Honey', 'usda', '169640', 100, 'g', 100, '{"sat_fat":0,"vit_e":0,"protein":0.3,"fiber":0.2,"iron":0.42,"magnesium":2,"phosphorus":4,"sodium":4,"copper":0.036,"manganese":0.08,"vit_c":0.5,"b1":0,"b2":0.038,"b12":0,"cholesterol":0,"fat":0,"carb":82.4,"kcal":304,"calcium":6,"potassium":52,"zinc":0.22,"b3":0.121,"b6":0.024,"sugar":82.1,"vit_k":0,"vit_d":0,"selenium":0.8,"vit_a":0,"folate":2}'::jsonb),
    ((select uid from me), 'NUTRITIONAL YEAST', 'usda', '2411476', 100, 'g', 100, '{"protein":50,"fat":0,"carb":33.3,"kcal":333,"potassium":1170,"sodium":83,"b1":2,"b2":51}'::jsonb),
    ((select uid from me), 'Vinegar, distilled', 'usda', '172237', 100, 'g', 100, '{"vit_k":0,"fat":0,"sugar":0.04,"zinc":0.01,"protein":0,"iron":0.03,"magnesium":1,"phosphorus":4,"copper":0.006,"manganese":0.055,"cholesterol":0,"trans_fat":0,"sat_fat":0,"vit_c":0,"b1":0,"b2":0,"b12":0,"vit_a":0,"sodium":2,"fiber":0,"carb":0.04,"kcal":18,"b3":0,"b6":0,"calcium":6,"potassium":2,"folate":0,"vit_d":0,"selenium":0.5,"vit_e":0}'::jsonb)
  returning id, source_id
),
recipe as (
  insert into public.foods
    (user_id, name, source, recipe_servings, serving_qty, serving_unit, nutrients)
  values ((select uid from me), 'Homemade Bagels', 'recipe', 4, 1, 'serving', '{"iron":3.01,"magnesium":14.38,"phosphorus":91.84,"sodium":7.99,"copper":0.09,"manganese":0.26,"protein":20.29,"b1":0.34,"b2":0.79,"fat":0.89,"carb":31.29,"kcal":213.38,"calcium":36.8,"potassium":82.97,"zinc":0.43,"b3":2.28,"b6":0.02,"selenium":13.76,"fiber":0.13,"vit_a":0,"sat_fat":0.06,"vit_k":0,"vit_c":0.01,"sugar":1.85,"vit_e":0,"folate":0.04,"cholesterol":0,"b12":0,"vit_d":0,"trans_fat":0}'::jsonb)
  returning id
)
insert into public.recipe_ingredients (user_id, recipe_food_id, ingredient_food_id, servings)
select (select uid from me), (select id from recipe), ing.id,
  case ing.source_id
    when '789890' then 1.35
    when '168147' then 0.85
    when '169640' then 0.09
    when '2411476' then 0.05
    when '172237' then 0.05
  end
from ing;
