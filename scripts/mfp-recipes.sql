-- MyFitnessPal recipes -> FitLog. Run once in the Supabase SQL Editor.
-- STEP 1: put your FitLog login email between the quotes below, then Run.
with me as (
  select id as uid from auth.users where email = '<<YOUR FITLOG LOGIN EMAIL>>'
),
new_ing as (
  insert into public.foods (user_id, name, source, source_id, serving_qty, serving_unit, serving_grams, nutrients)
  select (select uid from me), v.name, 'usda', v.source_id, 100, 'g', 100, v.nutrients
  from (values
      ('168903', 'Macaroni, vegetable, enriched, dry', '{"folate":460,"vit_a":8,"fat":1.04,"carb":74.9,"kcal":367,"calcium":34,"potassium":285,"zinc":0.76,"b3":7.33,"b6":0.129,"protein":13.1,"iron":4.28,"magnesium":46,"phosphorus":116,"sodium":43,"copper":0.2,"manganese":3.85,"b12":0,"cholesterol":0,"sat_fat":0.15,"vit_c":0,"b1":1.03,"b2":0.525,"fiber":4.3,"vit_d":0}'::jsonb),
      ('746782', 'Milk, whole, 3.25% milkfat, with added vitamin D', '{"vit_a":32,"cholesterol":12,"selenium":1.9,"fat":3.2,"carb":4.63,"kcal":60,"sat_fat":1.86,"vit_d":0.96,"iron":0,"magnesium":11.9,"phosphorus":101,"sodium":38,"copper":0.001,"manganese":0,"protein":3.27,"b1":0.056,"b2":0.138,"b12":0.54,"b3":0.105,"b6":0.061,"calcium":123,"potassium":150,"zinc":0.42,"vit_e":0.05,"trans_fat":0.112}'::jsonb),
      ('328637', 'Cheese, cheddar', '{"calcium":707,"potassium":77,"zinc":3.67,"carb":2.44,"kcal":408,"protein":23.3,"phosphorus":458,"copper":0.033,"vit_a":316,"b3":0.052,"b6":0.069,"fat":34,"selenium":28.3,"vit_e":0.75,"cholesterol":100,"sat_fat":19.2,"b1":0.029,"b2":0.441,"b12":1.06,"vit_k":2.4,"manganese":0.026,"sodium":654,"iron":0.16,"magnesium":26.8,"trans_fat":1.14}'::jsonb),
      ('169080', 'Cheese, pasteurized process, American, low fat', '{"vit_e":0.27,"sugar":0.59,"vit_k":2.7,"b12":0.77,"vit_a":57,"vit_c":0,"b1":0.03,"b2":0.39,"cholesterol":35,"sat_fat":4.41,"vit_d":0.1,"protein":24.6,"copper":0.033,"fiber":0,"iron":0.43,"magnesium":24,"phosphorus":827,"fat":7,"carb":3.5,"kcal":180,"calcium":684,"potassium":180,"zinc":3.32,"folate":9,"b3":0.08,"b6":0.08,"sodium":1790,"selenium":16.6}'::jsonb),
      ('172475', 'Tofu, raw, firm, prepared with calcium sulfate', '{"iron":2.66,"fiber":2.3,"trans_fat":0,"carb":2.78,"kcal":144,"protein":17.3,"folate":29,"vit_d":0,"magnesium":58,"phosphorus":190,"vit_c":0.2,"b1":0.158,"b2":0.102,"b12":0,"sat_fat":1.26,"cholesterol":0,"sodium":14,"copper":0.378,"manganese":1.18,"calcium":683,"fat":8.72,"potassium":237,"zinc":1.57,"b3":0.381,"b6":0.092,"selenium":17.4}'::jsonb),
      ('171287', 'Egg, whole, raw, fresh', '{"kcal":143,"b1":0.04,"b2":0.457,"b12":0.89,"cholesterol":372,"trans_fat":0.038,"sat_fat":3.13,"protein":12.6,"iron":1.75,"magnesium":12,"phosphorus":198,"sodium":142,"copper":0.072,"manganese":0.028,"vit_a":160,"selenium":30.7,"vit_e":1.05,"sugar":0.37,"calcium":56,"potassium":138,"zinc":1.29,"fat":9.51,"b3":0.075,"b6":0.17,"folate":47,"carb":0.72,"vit_d":2,"vit_k":0.3,"vit_c":0,"fiber":0}'::jsonb),
      ('171052', 'Chicken, broilers or fryers, meat only, raw', '{"folate":7,"vit_a":16,"vit_d":0.1,"selenium":15.7,"fat":3.08,"carb":0,"kcal":119,"calcium":12,"potassium":229,"zinc":1.54,"b3":8.24,"b6":0.43,"protein":21.4,"fiber":0,"iron":0.89,"magnesium":25,"phosphorus":173,"sodium":77,"copper":0.053,"manganese":0.019,"cholesterol":70,"sat_fat":0.79,"b1":0.073,"b2":0.142,"b12":0.37,"sugar":0,"vit_e":0.21,"vit_c":2.3,"vit_k":1.8}'::jsonb),
      ('169742', 'Rice noodles, dry', '{"vit_a":0,"vit_d":0,"vit_k":0,"fat":0.56,"kcal":364,"calcium":18,"potassium":30,"zinc":0.74,"b3":0.221,"b6":0.015,"cholesterol":0,"vit_c":0,"b1":0.031,"b2":0.017,"b12":0,"fiber":1.6,"iron":0.7,"magnesium":12,"phosphorus":153,"sodium":182,"copper":0.078,"manganese":0.498,"selenium":15.1,"vit_e":0.11,"folate":3,"sugar":0.12,"protein":5.95,"carb":80.2,"sat_fat":0.153}'::jsonb),
      ('746784', 'Sugars, granulated', '{"protein":0,"iron":0.05,"magnesium":0.3,"phosphorus":0,"sodium":1,"copper":0.007,"manganese":0.004,"fat":0.32,"kcal":385,"calcium":1,"potassium":2,"zinc":0.01,"carb":99.6}'::jsonb),
      ('172370', 'Oil, vegetable, soybean, refined', '{"vit_k":184,"vit_e":8.18,"folate":0,"protein":0,"fiber":0,"iron":0.02,"magnesium":0,"phosphorus":0,"sodium":0,"copper":0,"vit_a":0,"vit_c":0,"b1":0,"b2":0,"b12":0,"cholesterol":0,"trans_fat":0.678,"sat_fat":15.3,"b3":0,"b6":0,"fat":100,"carb":0,"kcal":884,"sugar":0,"calcium":0,"potassium":0,"zinc":0,"selenium":0}'::jsonb),
      ('174262', 'Peanuts, all types, dry-roasted, with salt', '{"b3":14.4,"b6":0.466,"sugar":4.9,"calcium":58,"potassium":634,"zinc":2.77,"carb":21.3,"kcal":587,"selenium":9.3,"vit_e":4.93,"folate":97,"b1":0.152,"b2":0.197,"b12":0,"vit_k":0,"vit_a":0,"fiber":8.4,"iron":1.58,"magnesium":178,"phosphorus":363,"sodium":410,"copper":0.428,"manganese":1.79,"protein":24.4,"cholesterol":0,"trans_fat":0.027,"sat_fat":7.72,"vit_d":0,"fat":49.7,"vit_c":0}'::jsonb),
      ('167763', 'Tamarinds, raw', '{"vit_k":2.8,"vit_e":0.1,"folate":14,"zinc":0.1,"copper":0.086,"sugar":38.8,"vit_a":2,"trans_fat":0,"fiber":5.1,"iron":2.8,"magnesium":92,"phosphorus":113,"protein":2.8,"sodium":28,"vit_c":3.5,"b1":0.428,"b2":0.152,"sat_fat":0.272,"b12":0,"cholesterol":0,"calcium":74,"potassium":628,"fat":0.6,"carb":62.5,"kcal":239,"b3":1.94,"b6":0.066,"vit_d":0,"selenium":1.3}'::jsonb),
      ('175179', 'Crustaceans, shrimp, raw', '{"fat":0.51,"carb":0,"kcal":85,"calcium":64,"potassium":264,"zinc":1.34,"protein":20.1,"iron":0.52,"magnesium":35,"phosphorus":214,"sodium":119,"copper":0.391,"manganese":0.033,"cholesterol":161,"trans_fat":0.004,"sat_fat":0.101}'::jsonb),
      ('2066343', 'FISH SAUCE', '{"protein":6.67,"fat":0,"carb":6.67,"kcal":67,"sugar":6.67,"fiber":0,"calcium":0,"iron":2.4,"sodium":10500,"vit_c":0,"cholesterol":0,"trans_fat":0,"sat_fat":0}'::jsonb),
      ('1883847', 'SOY SAUCE', '{"protein":10,"fat":0,"carb":0,"kcal":50,"sugar":0,"fiber":0,"calcium":0,"iron":0,"sodium":6000,"vit_c":0,"cholesterol":0,"trans_fat":0,"sat_fat":0}'::jsonb),
      ('329370', 'Cheese, mozzarella, low moisture, part-skim', '{"vit_k":1.3,"vit_a":203,"magnesium":27.2,"b12":1.65,"b1":0.023,"b2":0.36,"phosphorus":533,"sodium":699,"copper":0.035,"manganese":0.035,"iron":0.2,"protein":23.7,"sat_fat":11.7,"cholesterol":65,"fat":20.4,"carb":4.44,"kcal":298,"calcium":693,"potassium":116,"zinc":3.62,"selenium":26.7,"vit_e":0.51,"b3":0.101,"b6":0.09,"trans_fat":0.705}'::jsonb),
      ('168147', 'Vital wheat gluten', '{"kcal":370,"protein":75.16,"fat":1.85,"carb":13.79,"fiber":0.6,"sugar":0,"calcium":142,"iron":5.2,"magnesium":25,"phosphorus":260,"potassium":100,"sodium":29,"zinc":0.85,"copper":0.182,"selenium":39.7,"vit_c":0,"b1":0,"b2":0,"b3":0,"b6":0,"folate":0,"b12":0,"vit_a":0,"vit_e":0,"vit_d":0,"vit_k":0,"sat_fat":0.272,"cholesterol":0}'::jsonb),
      ('789890', 'Flour, wheat, all-purpose, enriched, bleached', '{"kcal":366,"protein":10.9,"fat":1.48,"carb":77.3,"calcium":19,"iron":5.62,"magnesium":26.7,"phosphorus":108,"potassium":136,"sodium":2,"zinc":0.72,"copper":0.155,"manganese":0.758,"selenium":15.7,"b1":0.939,"b2":0.443,"b3":6.74,"b6":0.066}'::jsonb),
      ('170501', 'Tomatoes, crushed, canned', '{"folate":13,"sodium":186,"b3":1.22,"b6":0.15,"fat":0.28,"carb":7.29,"kcal":32,"calcium":34,"potassium":293,"zinc":0.27,"copper":0.183,"manganese":0.183,"fiber":1.9,"iron":1.3,"magnesium":20,"phosphorus":32,"protein":1.64,"vit_c":9.2,"b1":0.075,"b2":0.052,"b12":0,"sat_fat":0.04,"cholesterol":0,"sugar":4.4,"vit_e":1.25,"vit_a":11,"vit_k":5.3,"trans_fat":0,"vit_d":0,"selenium":0.6}'::jsonb),
      ('171247', 'Cheese, parmesan, grated', '{"vit_d":0.5,"fat":27.8,"carb":13.9,"kcal":420,"sugar":0.07,"calcium":853,"potassium":180,"zinc":4.2,"selenium":34.4,"vit_e":0.53,"b3":0.08,"b6":0.081,"folate":6,"protein":28.4,"iron":0.49,"magnesium":34,"phosphorus":627,"sodium":1800,"copper":0.04,"manganese":0.071,"vit_a":262,"cholesterol":86,"trans_fat":0.876,"sat_fat":15.4,"vit_k":1.7,"b1":0.026,"b2":0.358,"b12":1.4,"fiber":0,"vit_c":0}'::jsonb),
      ('2433461', 'LITE COCONUT MILK', '{"protein":0,"fat":6.25,"carb":1.25,"kcal":56,"sugar":0,"fiber":0,"calcium":0,"iron":0.25,"sodium":6,"cholesterol":0,"trans_fat":0,"sat_fat":5}'::jsonb),
      ('170393', 'Carrots, raw', '{"sat_fat":0.032,"vit_k":13.2,"iron":0.3,"magnesium":12,"phosphorus":35,"sodium":69,"copper":0.045,"manganese":0.143,"vit_c":5.9,"b1":0.066,"b2":0.058,"protein":0.93,"selenium":0.1,"vit_e":0.66,"fat":0.24,"calcium":33,"potassium":320,"zinc":0.24,"b3":0.983,"b6":0.138,"b12":0,"cholesterol":0,"sugar":4.74,"carb":9.58,"kcal":41,"folate":19,"trans_fat":0,"vit_a":835,"fiber":2.8,"vit_d":0}'::jsonb),
      ('1871019', 'CURRY PASTE', '{"protein":0,"fat":25,"carb":18.8,"kcal":312,"sugar":0,"fiber":0,"calcium":0,"iron":4.5,"sodium":3000,"vit_c":0,"cholesterol":0,"sat_fat":6.25}'::jsonb),
      ('170171', 'Nuts, coconut cream, canned, sweetened', '{"vit_d":0,"vit_c":0,"trans_fat":0,"sat_fat":15.5,"fiber":0.2,"iron":0.13,"protein":1.17,"sodium":36,"vit_a":0,"sugar":51.5,"calcium":4,"fat":16.3,"carb":53.2,"kcal":357,"folate":14,"b3":0.038,"b6":0.029,"potassium":101,"zinc":0.6,"magnesium":17,"phosphorus":22,"copper":0.236,"manganese":0.815,"cholesterol":0,"b1":0.022,"b2":0.04,"b12":0,"vit_e":0.13,"vit_k":0.1,"selenium":5.5}'::jsonb),
      ('172884', 'Soup, stock, chicken, home-prepared', '{"vit_a":1,"vit_k":0.2,"vit_e":0.03,"sugar":1.58,"fat":1.2,"carb":3.53,"kcal":36,"b3":1.58,"b6":0.061,"calcium":3,"potassium":105,"zinc":0.14,"protein":2.52,"b12":0,"vit_c":0.2,"b1":0.035,"b2":0.085,"fiber":0,"iron":0.21,"magnesium":4,"phosphorus":27,"sodium":143,"copper":0.054,"cholesterol":3,"sat_fat":0.321,"folate":5,"vit_d":0,"selenium":2.2}'::jsonb),
      ('2346403', 'Potatoes, gold, without skin, raw', '{"iron":0.373,"magnesium":22.3,"phosphorus":57,"potassium":446,"sodium":2.24,"zinc":0.374,"copper":0.13,"vit_c":23.3,"manganese":0.16,"b1":0.0512,"selenium":0,"b3":1.58,"b6":0.145,"fat":0.264,"calcium":5.94,"protein":1.81,"carb":16,"vit_k":0.8,"kcal":73.5}'::jsonb),
      ('170008', 'Onions, sweet, raw', '{"trans_fat":0,"sugar":5.02,"carb":7.55,"kcal":32,"b3":0.133,"b6":0.13,"calcium":20,"potassium":119,"zinc":0.13,"selenium":0.5,"fat":0.08,"vit_c":4.8,"b1":0.041,"b2":0.02,"vit_k":0.3,"fiber":0.9,"iron":0.26,"magnesium":9,"phosphorus":27,"sodium":8,"copper":0.056,"manganese":0.076,"protein":0.8,"vit_a":0,"vit_e":0.02,"cholesterol":0,"vit_d":0}'::jsonb),
      ('173627', 'Chicken, broilers or fryers, dark meat, thigh, meat only, raw', '{"calcium":7,"potassium":242,"zinc":1.58,"selenium":22.9,"kcal":121,"fat":4.12,"b3":5.56,"b6":0.451,"phosphorus":185,"sodium":95,"copper":0.062,"manganese":0.013,"protein":19.7,"iron":0.81,"b1":0.088,"b2":0.196,"cholesterol":94,"trans_fat":0.02,"sat_fat":1.1,"b12":0.61,"magnesium":23,"vit_a":7,"vit_d":0,"vit_e":0.18,"folate":4,"vit_k":2.9,"sugar":0,"carb":0,"fiber":0,"vit_c":0}'::jsonb),
      ('171413', 'Oil, olive, salad or cooking', '{"vit_e":14.4,"fat":100,"carb":0,"kcal":884,"calcium":1,"potassium":1,"zinc":0,"iron":0.56,"magnesium":0,"phosphorus":0,"sodium":2,"copper":0,"manganese":0,"protein":0,"vit_a":0,"sat_fat":13.8,"folate":0,"cholesterol":0,"fiber":0,"vit_c":0,"b1":0,"b2":0,"b12":0,"b3":0,"b6":0,"selenium":0,"sugar":0,"vit_k":60.2,"vit_d":0}'::jsonb),
      ('2346405', 'Celery, raw', '{"iron":0,"magnesium":10.9,"phosphorus":21.6,"potassium":265,"sodium":97.2,"zinc":0.0929,"copper":0,"fat":0.162,"manganese":0.076,"selenium":0,"b6":0.0518,"calcium":46.3,"protein":0.492,"carb":3.32,"kcal":16.7}'::jsonb),
      ('170005', 'Onions, spring or scallions (includes tops and bulb), raw', '{"sugar":2.33,"vit_e":0.55,"vit_a":50,"kcal":32,"folate":64,"b12":0,"trans_fat":0,"fat":0.19,"calcium":72,"potassium":276,"zinc":0.39,"b3":0.525,"b6":0.061,"protein":1.83,"vit_c":18.8,"b1":0.055,"b2":0.08,"fiber":2.6,"iron":1.48,"magnesium":20,"phosphorus":37,"sodium":16,"copper":0.083,"manganese":0.16,"sat_fat":0.032,"cholesterol":0,"carb":7.34,"vit_k":207,"vit_d":0,"selenium":0.6}'::jsonb),
      ('747447', 'Broccoli, raw', '{"sat_fat":0.039,"carb":6.27,"kcal":31,"fat":0.34,"calcium":46,"potassium":303,"zinc":0.42,"selenium":1.6,"vit_e":0.15,"b3":0.639,"b6":0.191,"protein":2.57,"fiber":2.4,"iron":0.69,"magnesium":21,"phosphorus":67,"sodium":36,"copper":0.059,"manganese":0.197,"vit_c":91.3,"b1":0.077,"b2":0.114,"vit_k":102,"vit_a":8}'::jsonb),
      ('170108', 'Peppers, sweet, red, raw', '{"fiber":2.1,"kcal":26,"trans_fat":0,"sat_fat":0.059,"vit_c":128,"sodium":4,"cholesterol":0,"vit_a":157,"folate":46,"sugar":4.2,"carb":6.03,"vit_k":4.9,"manganese":0.112,"vit_e":1.58,"copper":0.017,"iron":0.43,"magnesium":12,"phosphorus":26,"protein":0.99,"b1":0.054,"b2":0.085,"b12":0,"calcium":7,"potassium":211,"zinc":0.25,"selenium":0.1,"b3":0.979,"b6":0.291,"fat":0.3,"vit_d":0}'::jsonb)
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
    and source_id in ('168903', '746782', '328637', '169080', '172475', '171287', '171052', '169742', '746784', '172370', '174262', '167763', '175179', '2066343', '1883847', '329370', '168147', '789890', '170501', '171247', '2433461', '170393', '1871019', '170171', '172884', '2346403', '170008', '173627', '171413', '2346405', '170005', '747447', '170108')
),
recipes as (
  insert into public.foods (user_id, name, source, recipe_servings, serving_qty, serving_unit, nutrients)
  values
    ((select uid from me), 'Mac N Cheese', 'recipe', 1, 1, 'serving', '{"kcal":465,"protein":26,"carb":71,"fat":9,"fiber":3,"sugar":7,"sat_fat":5,"trans_fat":0,"cholesterol":25,"sodium":675,"potassium":264,"calcium":936,"iron":2.7,"vit_a":0,"vit_c":0}'::jsonb),
    ((select uid from me), 'Homemade Pad Thai with Chicken', 'recipe', 6, 1, 'serving', '{"kcal":708,"protein":53,"carb":63,"fat":26,"fiber":5,"sugar":5,"sat_fat":5,"cholesterol":321,"sodium":667,"potassium":657,"calcium":208,"iron":3.24,"vit_a":27,"vit_c":0.9}'::jsonb),
    ((select uid from me), 'Pan Pizza', 'recipe', 5, 1, 'serving', '{"kcal":672,"protein":52,"carb":86,"fat":12,"fiber":4,"sugar":0,"sat_fat":7,"cholesterol":37,"sodium":656,"potassium":127,"calcium":1144,"iron":7.92,"vit_a":162,"vit_c":0}'::jsonb),
    ((select uid from me), 'Homemade Thai Yellow Curry with Chicken', 'recipe', 6, 1, 'serving', '{"kcal":496,"protein":37,"carb":39,"fat":20,"fiber":5,"sugar":10,"sat_fat":15,"cholesterol":99,"sodium":923,"potassium":1547,"calcium":78,"iron":3.06,"vit_a":1827,"vit_c":33.3}'::jsonb),
    ((select uid from me), 'Kung Pao Chicken', 'recipe', 6, 1, 'serving', '{"kcal":426,"protein":32,"carb":13,"fat":28,"fiber":5,"sugar":4,"sat_fat":4,"cholesterol":124,"sodium":239,"potassium":897,"calcium":143,"iron":2.88,"vit_a":36,"vit_c":144}'::jsonb)
  returning id, name
)
insert into public.recipe_ingredients (user_id, recipe_food_id, ingredient_food_id, servings)
select (select uid from me), r.id, i.id, li.servings
from (values
    ('Mac N Cheese', '168903', 0.84),
    ('Mac N Cheese', '746782', 0.81),
    ('Mac N Cheese', '328637', 0.14),
    ('Mac N Cheese', '169080', 0.42),
    ('Homemade Pad Thai with Chicken', '172475', 5.1),
    ('Homemade Pad Thai with Chicken', '171287', 3),
    ('Homemade Pad Thai with Chicken', '171052', 8.16),
    ('Homemade Pad Thai with Chicken', '169742', 3.4),
    ('Homemade Pad Thai with Chicken', '746784', 0.36),
    ('Homemade Pad Thai with Chicken', '172370', 0.41),
    ('Homemade Pad Thai with Chicken', '174262', 0.73),
    ('Homemade Pad Thai with Chicken', '167763', 0.57),
    ('Homemade Pad Thai with Chicken', '175179', 0.14),
    ('Homemade Pad Thai with Chicken', '2066343', 0.36),
    ('Homemade Pad Thai with Chicken', '1883847', 0.16),
    ('Pan Pizza', '329370', 3),
    ('Pan Pizza', '168147', 1),
    ('Pan Pizza', '789890', 5),
    ('Pan Pizza', '170501', 4),
    ('Pan Pizza', '171247', 1.4),
    ('Homemade Thai Yellow Curry with Chicken', '2433461', 3.96),
    ('Homemade Thai Yellow Curry with Chicken', '170393', 3.6),
    ('Homemade Thai Yellow Curry with Chicken', '1871019', 0.64),
    ('Homemade Thai Yellow Curry with Chicken', '170171', 3.96),
    ('Homemade Thai Yellow Curry with Chicken', '172884', 2.4),
    ('Homemade Thai Yellow Curry with Chicken', '2346403', 6),
    ('Homemade Thai Yellow Curry with Chicken', '171052', 8.16),
    ('Homemade Thai Yellow Curry with Chicken', '170008', 1.1),
    ('Kung Pao Chicken', '173627', 7.94),
    ('Kung Pao Chicken', '171413', 0.95),
    ('Kung Pao Chicken', '2346405', 2.4),
    ('Kung Pao Chicken', '170005', 0.72),
    ('Kung Pao Chicken', '747447', 3.64),
    ('Kung Pao Chicken', '170108', 1.19),
    ('Kung Pao Chicken', '174262', 0.73)
) as li(recipe_name, source_id, servings)
join recipes r on r.name = li.recipe_name
join ing i on i.source_id = li.source_id;
