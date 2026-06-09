-- MyFitnessPal recipes -> FitLog. Run once in the Supabase SQL Editor.
-- STEP 1: put your FitLog login email between the quotes below, then Run.
with me as (
  select id as uid from auth.users where email = '<<YOUR FITLOG LOGIN EMAIL>>'
),
new_ing as (
  insert into public.foods (user_id, name, source, source_id, serving_qty, serving_unit, serving_grams, nutrients)
  select (select uid from me), v.name, 'usda', v.source_id, 100, 'g', 100, v.nutrients
  from (values
      ('746784', 'Sugars, granulated', '{"protein":0,"iron":0.05,"magnesium":0.3,"phosphorus":0,"sodium":1,"copper":0.007,"manganese":0.004,"fat":0.32,"kcal":385,"calcium":1,"potassium":2,"zinc":0.01,"carb":99.6}'::jsonb),
      ('173471', 'Vanilla extract', '{"calcium":11,"potassium":148,"zinc":0.11,"b3":0.425,"b6":0.026,"fat":0.06,"carb":12.6,"kcal":288,"protein":0.06,"fiber":0,"iron":0.12,"magnesium":12,"phosphorus":6,"sodium":9,"copper":0.072,"manganese":0.23,"vit_c":0,"b1":0.011,"b2":0.095,"b12":0,"cholesterol":0,"sat_fat":0.01,"trans_fat":0,"vit_e":0,"sugar":12.6,"vit_a":0,"vit_k":0,"folate":0,"vit_d":0,"selenium":0}'::jsonb),
      ('172184', 'Egg, yolk, raw, fresh', '{"vit_e":2.58,"sugar":0.56,"manganese":0.055,"vit_k":0.7,"b3":0.024,"calcium":129,"potassium":109,"zinc":2.3,"selenium":56,"fat":26.5,"b6":0.35,"protein":15.9,"iron":2.73,"magnesium":5,"phosphorus":390,"sodium":48,"copper":0.077,"b1":0.176,"b2":0.528,"b12":1.95,"cholesterol":1080,"folate":146,"carb":3.59,"kcal":322,"sat_fat":9.55,"vit_a":381,"vit_d":5.4,"fiber":0,"vit_c":0}'::jsonb),
      ('2392047', 'ERYTHRITOL NATURAL SWEETENER, ERYTHRITOL', '{"protein":0,"fat":0,"carb":100,"kcal":0,"sugar":0,"fiber":0,"calcium":0,"iron":0,"potassium":0,"sodium":0,"cholesterol":0}'::jsonb),
      ('746782', 'Milk, whole, 3.25% milkfat, with added vitamin D', '{"vit_a":32,"cholesterol":12,"selenium":1.9,"fat":3.2,"carb":4.63,"kcal":60,"sat_fat":1.86,"vit_d":0.96,"iron":0,"magnesium":11.9,"phosphorus":101,"sodium":38,"copper":0.001,"manganese":0,"protein":3.27,"b1":0.056,"b2":0.138,"b12":0.54,"b3":0.105,"b6":0.061,"calcium":123,"potassium":150,"zinc":0.42,"vit_e":0.05,"trans_fat":0.112}'::jsonb),
      ('168450', 'Pumpkin, canned, without salt', '{"fiber":2.9,"vit_a":778,"folate":12,"carb":8.09,"kcal":34,"protein":1.1,"vit_k":16,"trans_fat":0,"fat":0.28,"calcium":26,"potassium":206,"zinc":0.17,"b3":0.367,"b6":0.056,"sat_fat":0.146,"cholesterol":0,"vit_c":4.2,"b1":0.024,"b2":0.054,"b12":0,"iron":1.39,"magnesium":23,"phosphorus":35,"sodium":5,"copper":0.107,"manganese":0.149,"vit_e":1.06,"sugar":3.3,"vit_d":0,"selenium":0.4}'::jsonb),
      ('328841', 'Cheese, cottage, lowfat, 2% milkfat', '{"vit_a":69,"fat":2.3,"carb":4.31,"kcal":84,"b3":0.09,"b6":0.057,"calcium":103,"potassium":120,"zinc":0.61,"selenium":14.6,"vit_e":0.08,"protein":11,"cholesterol":12,"trans_fat":0.069,"sat_fat":1.26,"b1":0.02,"b2":0.234,"b12":0.42,"iron":0.13,"magnesium":8.9,"phosphorus":148,"sodium":321,"copper":0.03,"manganese":0.015}'::jsonb),
      ('789890', 'Flour, wheat, all-purpose, enriched, bleached', '{"iron":5.62,"magnesium":26.7,"phosphorus":108,"sodium":2,"copper":0.155,"manganese":0.758,"protein":10.9,"b1":0.939,"b2":0.443,"fat":1.48,"carb":77.3,"kcal":366,"calcium":19,"potassium":136,"zinc":0.72,"b3":6.74,"b6":0.066,"selenium":15.7}'::jsonb),
      ('2666789', 'WHEY + CASEIN PROTEIN POWDER', '{"protein":60.6,"fat":3.03,"carb":24.2,"kcal":364,"sugar":18.2,"fiber":3,"calcium":909,"iron":0,"potassium":758,"sodium":424,"vit_c":0,"cholesterol":152,"trans_fat":0,"sat_fat":1.52,"vit_a":0}'::jsonb),
      ('171413', 'Oil, olive, salad or cooking', '{"vit_e":14.4,"fat":100,"carb":0,"kcal":884,"calcium":1,"potassium":1,"zinc":0,"iron":0.56,"magnesium":0,"phosphorus":0,"sodium":2,"copper":0,"manganese":0,"protein":0,"vit_a":0,"sat_fat":13.8,"folate":0,"cholesterol":0,"fiber":0,"vit_c":0,"b1":0,"b2":0,"b12":0,"b3":0,"b6":0,"selenium":0,"sugar":0,"vit_k":60.2,"vit_d":0}'::jsonb),
      ('173442', 'Sour cream, reduced fat', '{"vit_k":0.7,"sugar":0.3,"vit_e":0.4,"vit_a":119,"vit_d":0.3,"protein":7,"fiber":0,"iron":0.06,"magnesium":11,"phosphorus":85,"sodium":70,"copper":0.01,"vit_c":0.9,"b1":0.04,"b2":0.24,"b12":0.3,"cholesterol":35,"sat_fat":8.7,"fat":14.1,"carb":7,"kcal":181,"folate":11,"b3":0.07,"b6":0.02,"calcium":141,"potassium":211,"zinc":0.27,"selenium":4.1}'::jsonb),
      ('171287', 'Egg, whole, raw, fresh', '{"kcal":143,"b1":0.04,"b2":0.457,"b12":0.89,"cholesterol":372,"trans_fat":0.038,"sat_fat":3.13,"protein":12.6,"iron":1.75,"magnesium":12,"phosphorus":198,"sodium":142,"copper":0.072,"manganese":0.028,"vit_a":160,"selenium":30.7,"vit_e":1.05,"sugar":0.37,"calcium":56,"potassium":138,"zinc":1.29,"fat":9.51,"b3":0.075,"b6":0.17,"folate":47,"carb":0.72,"vit_d":2,"vit_k":0.3,"vit_c":0,"fiber":0}'::jsonb),
      ('168147', 'Vital wheat gluten', '{"protein":75.2,"fiber":0.6,"iron":5.2,"magnesium":25,"phosphorus":260,"sodium":29,"copper":0.182,"vit_a":0,"sat_fat":0.272,"vit_k":0,"vit_c":0,"b1":0,"b2":0,"fat":1.85,"carb":13.8,"kcal":370,"sugar":0,"calcium":142,"potassium":100,"zinc":0.85,"selenium":39.7,"vit_e":0,"b3":0,"folate":0,"b6":0,"cholesterol":0,"b12":0,"vit_d":0}'::jsonb),
      ('168896', 'Wheat flour, white, bread, enriched', '{"vit_e":0.4,"vit_k":0.3,"sugar":0.31,"protein":12,"cholesterol":0,"sat_fat":0.244,"b12":0,"fiber":2.4,"iron":4.41,"magnesium":25,"phosphorus":97,"sodium":2,"copper":0.182,"manganese":0.792,"vit_c":0,"b1":0.812,"b2":0.512,"calcium":15,"potassium":100,"zinc":0.85,"b3":7.55,"b6":0.037,"fat":1.66,"carb":72.5,"kcal":361,"vit_a":0,"vit_d":0,"selenium":39.7,"folate":288}'::jsonb),
      ('2127866', 'DOUGHING ME, DOUGHING YOU GELATO, DOUGHING ME, DOUGHING YOU', '{"protein":4,"fat":9,"carb":30,"kcal":220,"sugar":26,"fiber":1,"calcium":100,"iron":0.36,"sodium":90,"vit_c":0,"cholesterol":25,"trans_fat":0,"sat_fat":5}'::jsonb),
      ('175043', 'Leavening agents, yeast, baker''s, active dry', '{"folate":2340,"b3":40.2,"b6":1.5,"fat":7.61,"carb":41.2,"kcal":325,"calcium":30,"potassium":955,"zinc":7.94,"selenium":7.9,"protein":40.4,"fiber":26.9,"iron":2.17,"magnesium":54,"phosphorus":637,"sodium":51,"copper":0.436,"manganese":0.312,"vit_a":0,"vit_c":0.3,"b1":11,"b2":4,"b12":0.07,"vit_k":0.4,"cholesterol":0,"sat_fat":1,"vit_e":0,"sugar":0,"vit_d":0}'::jsonb),
      ('168944', 'Wheat flour, whole-grain, soft wheat', '{"vit_c":0,"b1":0.297,"b2":0.188,"vit_k":1.9,"cholesterol":0,"sat_fat":0.43,"protein":9.61,"fiber":13.1,"iron":3.71,"magnesium":117,"phosphorus":323,"sodium":3,"copper":0.475,"manganese":3.4,"vit_a":0,"vit_d":0,"calcium":33,"potassium":394,"zinc":2.96,"selenium":12.7,"vit_e":0.53,"b3":5.35,"b6":0.191,"folate":28,"fat":1.95,"carb":74.5,"kcal":332,"sugar":1.02}'::jsonb)
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
    and source_id in ('746784', '173471', '172184', '2392047', '746782', '168450', '328841', '789890', '2666789', '171413', '173442', '171287', '168147', '168896', '2127866', '175043', '168944')
),
recipes as (
  insert into public.foods (user_id, name, source, recipe_servings, serving_qty, serving_unit, nutrients)
  values
    ((select uid from me), 'Ninja Creami - Vanilla', 'recipe', 1, 1, 'serving', '{"kcal":373,"protein":27,"carb":17,"fat":20,"fiber":0,"sugar":16,"sat_fat":11,"trans_fat":0,"cholesterol":241,"sodium":259,"potassium":786,"calcium":780,"iron":0.54,"vit_a":252,"vit_c":0}'::jsonb),
    ((select uid from me), 'Protein Pumpkin Muffin', 'recipe', 6, 1, 'serving', '{"kcal":249,"protein":18,"carb":25,"fat":7,"fiber":0,"sugar":10,"sat_fat":2,"trans_fat":0,"cholesterol":66,"sodium":90,"potassium":57,"calcium":39,"iron":1.08,"vit_a":306,"vit_c":0.9}'::jsonb),
    ((select uid from me), 'Protein Baguette', 'recipe', 1, 1, 'serving', '{"kcal":316,"protein":19,"carb":55,"fat":1,"fiber":0,"sugar":0,"sat_fat":0,"trans_fat":0,"cholesterol":0,"sodium":4,"potassium":13,"calcium":26,"iron":0.72,"vit_a":0,"vit_c":0}'::jsonb),
    ((select uid from me), 'Homemade Sliced Bread', 'recipe', 19, 1, 'serving', '{"kcal":77,"protein":7,"carb":10,"fat":1,"fiber":1,"sugar":0,"sat_fat":0,"trans_fat":0,"cholesterol":2,"sodium":18,"potassium":33,"calcium":39,"iron":0.9,"vit_a":0,"vit_c":0.9}'::jsonb),
    ((select uid from me), 'Protein Rotis', 'recipe', 5, 1, 'serving', '{"kcal":132,"protein":12,"carb":20,"fat":2,"fiber":2,"sugar":0,"sat_fat":0,"trans_fat":0,"cholesterol":0,"sodium":3,"potassium":12,"calcium":26,"iron":0.54,"vit_a":0,"vit_c":0}'::jsonb)
  returning id, name
)
insert into public.recipe_ingredients (user_id, recipe_food_id, ingredient_food_id, servings)
select (select uid from me), r.id, i.id, li.servings
from (values
    ('Ninja Creami - Vanilla', '746784', 0.04),
    ('Ninja Creami - Vanilla', '173471', 0.05),
    ('Ninja Creami - Vanilla', '172184', 0.17),
    ('Ninja Creami - Vanilla', '2392047', 0.04),
    ('Ninja Creami - Vanilla', '746782', 4.64),
    ('Protein Pumpkin Muffin', '168450', 4.25),
    ('Protein Pumpkin Muffin', '328841', 0.9),
    ('Protein Pumpkin Muffin', '789890', 0.9),
    ('Protein Pumpkin Muffin', '2666789', 1.02),
    ('Protein Pumpkin Muffin', '746784', 0.4),
    ('Protein Pumpkin Muffin', '171413', 0.27),
    ('Protein Pumpkin Muffin', '173442', 0.9),
    ('Protein Pumpkin Muffin', '171287', 1),
    ('Protein Baguette', '789890', 0.75),
    ('Protein Baguette', '168147', 0.13),
    ('Homemade Sliced Bread', '168896', 2.2),
    ('Homemade Sliced Bread', '2127866', 0.15),
    ('Homemade Sliced Bread', '746782', 2.9),
    ('Homemade Sliced Bread', '175043', 0.1),
    ('Homemade Sliced Bread', '168147', 1.1),
    ('Protein Rotis', '168147', 0.6),
    ('Protein Rotis', '168944', 1.2)
) as li(recipe_name, source_id, servings)
join recipes r on r.name = li.recipe_name
join ing i on i.source_id = li.source_id;
