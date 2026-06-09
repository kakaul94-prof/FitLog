-- MyFitnessPal recipes -> FitLog. Run once in the Supabase SQL Editor.
-- STEP 1: put your FitLog login email between the quotes below, then Run.
with me as (
  select id as uid from auth.users where email = '<<YOUR FITLOG LOGIN EMAIL>>'
),
new_ing as (
  insert into public.foods (user_id, name, source, source_id, serving_qty, serving_unit, serving_grams, nutrients)
  select (select uid from me), v.name, 'usda', v.source_id, 100, 'g', 100, v.nutrients
  from (values
      ('169698', 'Cornstarch', '{"vit_a":0,"folate":0,"vit_k":0,"sugar":0,"vit_e":0,"fat":0.05,"carb":91.3,"kcal":381,"calcium":2,"potassium":3,"zinc":0.06,"b3":0,"b6":0,"protein":0.26,"fiber":0.9,"iron":0.47,"magnesium":3,"phosphorus":13,"sodium":9,"copper":0.05,"manganese":0.053,"cholesterol":0,"sat_fat":0.009,"vit_c":0,"b1":0,"b2":0,"b12":0,"vit_d":0,"selenium":2.8}'::jsonb),
      ('169736', 'Pasta, dry, enriched', '{"magnesium":53,"phosphorus":189,"sodium":6,"copper":0.289,"manganese":0.917,"sugar":2.67,"calcium":21,"potassium":223,"zinc":1.41,"vit_a":0,"iron":3.3,"b1":0.891,"b2":0.4,"trans_fat":0,"sat_fat":0.277,"carb":74.7,"kcal":371,"b3":7.18,"folate":391,"vit_c":0,"b12":0,"cholesterol":0,"selenium":63.2,"vit_e":0.11,"fat":1.51,"b6":0.142,"fiber":3.2,"vit_k":0.1,"protein":13,"vit_d":0}'::jsonb),
      ('170848', 'Cheese, parmesan, hard', '{"vit_k":1.7,"folate":7,"vit_e":0.22,"vit_d":0.5,"vit_a":207,"sodium":1180,"sat_fat":14.8,"sugar":0.11,"fat":25,"copper":0.032,"manganese":0.02,"vit_c":0,"b1":0.039,"b2":0.332,"b12":1.2,"fiber":0,"iron":0.82,"magnesium":44,"phosphorus":694,"cholesterol":68,"protein":35.8,"carb":3.22,"kcal":392,"calcium":1180,"potassium":92,"zinc":2.75,"b3":0.271,"b6":0.091,"selenium":22.5}'::jsonb),
      ('746782', 'Milk, whole, 3.25% milkfat, with added vitamin D', '{"vit_a":32,"cholesterol":12,"selenium":1.9,"fat":3.2,"carb":4.63,"kcal":60,"sat_fat":1.86,"vit_d":0.96,"iron":0,"magnesium":11.9,"phosphorus":101,"sodium":38,"copper":0.001,"manganese":0,"protein":3.27,"b1":0.056,"b2":0.138,"b12":0.54,"b3":0.105,"b6":0.061,"calcium":123,"potassium":150,"zinc":0.42,"vit_e":0.05,"trans_fat":0.112}'::jsonb),
      ('328637', 'Cheese, cheddar', '{"calcium":707,"potassium":77,"zinc":3.67,"carb":2.44,"kcal":408,"protein":23.3,"phosphorus":458,"copper":0.033,"vit_a":316,"b3":0.052,"b6":0.069,"fat":34,"selenium":28.3,"vit_e":0.75,"cholesterol":100,"sat_fat":19.2,"b1":0.029,"b2":0.441,"b12":1.06,"vit_k":2.4,"manganese":0.026,"sodium":654,"iron":0.16,"magnesium":26.8,"trans_fat":1.14}'::jsonb),
      ('2020713', 'OATS', '{"protein":12.5,"fat":6.25,"carb":67.5,"kcal":375,"sugar":2.5,"fiber":10,"calcium":0,"iron":4.5,"sodium":0,"vit_c":0,"cholesterol":0,"trans_fat":0,"sat_fat":1.25}'::jsonb),
      ('2346411', 'Blueberries, raw', '{"iron":0.34,"magnesium":6.18,"phosphorus":13,"potassium":85.6,"sodium":0,"zinc":0.0853,"copper":0.046,"vit_c":8.06,"fat":0.306,"manganese":0.423,"calcium":11.7,"protein":0.703,"carb":14.6,"kcal":63.9}'::jsonb),
      ('173944', 'Bananas, raw', '{"sat_fat":0.112,"vit_a":3,"carb":22.8,"kcal":89,"folate":20,"trans_fat":0,"b12":0,"cholesterol":0,"vit_d":0,"vit_k":0.5,"vit_c":8.7,"b1":0.031,"b2":0.073,"fiber":2.6,"iron":0.26,"magnesium":27,"phosphorus":22,"sodium":1,"copper":0.078,"manganese":0.27,"protein":1.09,"sugar":12.2,"calcium":5,"potassium":358,"zinc":0.15,"fat":0.33,"b3":0.665,"b6":0.367,"selenium":1,"vit_e":0.1}'::jsonb),
      ('171706', 'Avocados, raw, California', '{"trans_fat":0,"fat":15.4,"sugar":0.3,"calcium":13,"potassium":507,"zinc":0.68,"selenium":0.4,"vit_e":1.97,"b3":1.91,"b6":0.287,"protein":1.96,"fiber":6.8,"iron":0.61,"magnesium":29,"phosphorus":54,"sodium":8,"copper":0.17,"manganese":0.149,"vit_c":8.8,"b1":0.075,"b2":0.143,"vit_a":7,"vit_k":21,"b12":0,"cholesterol":0,"carb":8.64,"kcal":167,"folate":89,"sat_fat":2.13,"vit_d":0}'::jsonb),
      ('174493', 'Turkey, ground, 85% lean, 15% fat, raw', '{"fat":12.5,"sugar":0,"calcium":33,"potassium":202,"zinc":2.75,"selenium":24.6,"vit_e":0.08,"b3":5.08,"b6":0.485,"cholesterol":78,"trans_fat":0.181,"sat_fat":3.41,"protein":16.9,"fiber":0,"iron":1.32,"magnesium":19,"phosphorus":179,"sodium":54,"copper":0.123,"manganese":0.009,"vit_a":30,"vit_d":0.4,"vit_c":0,"b1":0.067,"b2":0.177,"b12":1.3,"folate":6,"carb":0,"kcal":180,"vit_k":0}'::jsonb),
      ('170043', 'Potatoes, hash brown, frozen, plain, unprepared', '{"folate":4,"vit_a":0,"fat":0.62,"carb":17.7,"kcal":82,"calcium":10,"potassium":285,"b3":1.66,"b6":0.087,"zinc":0.21,"sat_fat":0.163,"sodium":22,"copper":0.099,"manganese":0.146,"vit_c":8.2,"b1":0.097,"b2":0.014,"b12":0,"protein":2.06,"fiber":1.4,"iron":0.98,"magnesium":11,"phosphorus":47,"vit_d":0,"selenium":0.3}'::jsonb),
      ('172183', 'Egg, white, raw, fresh', '{"vit_c":0,"vit_k":0,"fiber":0,"manganese":0.011,"sugar":0.71,"vit_e":0,"b1":0.004,"b2":0.439,"b12":0.09,"iron":0.08,"magnesium":11,"phosphorus":15,"sodium":166,"copper":0.023,"protein":10.9,"calcium":7,"potassium":163,"zinc":0.03,"selenium":20,"fat":0.17,"b6":0.005,"b3":0.105,"cholesterol":0,"sat_fat":0,"kcal":52,"vit_d":0,"carb":0.73,"folate":4,"vit_a":0}'::jsonb),
      ('2676733', 'CARB BALANCE FLOUR TORTILLA WRAPS, CARB BALANCE', '{"protein":14.1,"fat":8.45,"carb":45.1,"kcal":155,"sugar":0,"fiber":39.4,"calcium":161,"iron":0,"potassium":34,"sodium":775,"vit_d":0,"added_sugar":0,"cholesterol":0,"trans_fat":0,"sat_fat":2.82}'::jsonb),
      ('171287', 'Egg, whole, raw, fresh', '{"kcal":143,"b1":0.04,"b2":0.457,"b12":0.89,"cholesterol":372,"trans_fat":0.038,"sat_fat":3.13,"protein":12.6,"iron":1.75,"magnesium":12,"phosphorus":198,"sodium":142,"copper":0.072,"manganese":0.028,"vit_a":160,"selenium":30.7,"vit_e":1.05,"sugar":0.37,"calcium":56,"potassium":138,"zinc":1.29,"fat":9.51,"b3":0.075,"b6":0.17,"folate":47,"carb":0.72,"vit_d":2,"vit_k":0.3,"vit_c":0,"fiber":0}'::jsonb),
      ('172370', 'Oil, vegetable, soybean, refined', '{"vit_k":184,"vit_e":8.18,"folate":0,"protein":0,"fiber":0,"iron":0.02,"magnesium":0,"phosphorus":0,"sodium":0,"copper":0,"vit_a":0,"vit_c":0,"b1":0,"b2":0,"b12":0,"cholesterol":0,"trans_fat":0.678,"sat_fat":15.3,"b3":0,"b6":0,"fat":100,"carb":0,"kcal":884,"sugar":0,"calcium":0,"potassium":0,"zinc":0,"selenium":0}'::jsonb),
      ('1851245', 'PECANS', '{"protein":10,"fat":73.3,"carb":13.3,"kcal":700,"sugar":3.33,"fiber":10,"calcium":67,"iron":2.4,"potassium":417,"sodium":0,"vit_c":0,"cholesterol":0,"trans_fat":0,"sat_fat":6.67}'::jsonb),
      ('2346397', 'Oats, whole grain, steel cut', '{"iron":3.8,"magnesium":129,"phosphorus":417,"potassium":376,"sodium":0.311,"zinc":2.84,"copper":0.411,"b1":0.334,"manganese":3.41,"b3":0.926,"selenium":29,"b6":0.119,"fat":5.8,"calcium":51.3,"carb":69.8,"protein":12.5,"kcal":381}'::jsonb),
      ('170471', 'Vegetables, mixed, frozen, unprepared', '{"folate":29,"fiber":4,"vit_a":254,"carb":13.5,"kcal":72,"trans_fat":0,"fat":0.52,"calcium":25,"potassium":212,"zinc":0.45,"b3":1.25,"b6":0.096,"protein":3.33,"sat_fat":0.098,"cholesterol":0,"vit_c":10.4,"b1":0.122,"b2":0.085,"b12":0,"iron":0.95,"magnesium":24,"phosphorus":59,"sodium":47,"copper":0.093,"manganese":0.244,"vit_d":0,"selenium":0.4}'::jsonb),
      ('173263', 'Rice, brown, parboiled, cooked, UNCLE BENS', '{"fat":0.85,"carb":31.3,"sugar":0.15,"calcium":3,"potassium":61,"zinc":0.77,"selenium":9.4,"vit_e":0,"b3":1.9,"b6":0.11,"fiber":1.7,"iron":0.53,"magnesium":39,"phosphorus":96,"sodium":4,"copper":0.129,"manganese":1.14,"b1":0.097,"b2":0.07,"vit_k":0.4,"trans_fat":0,"sat_fat":0.213,"protein":3.09,"kcal":147}'::jsonb),
      ('171052', 'Chicken, broilers or fryers, meat only, raw', '{"folate":7,"vit_a":16,"vit_d":0.1,"selenium":15.7,"fat":3.08,"carb":0,"kcal":119,"calcium":12,"potassium":229,"zinc":1.54,"b3":8.24,"b6":0.43,"protein":21.4,"fiber":0,"iron":0.89,"magnesium":25,"phosphorus":173,"sodium":77,"copper":0.053,"manganese":0.019,"cholesterol":70,"sat_fat":0.79,"b1":0.073,"b2":0.142,"b12":0.37,"sugar":0,"vit_e":0.21,"vit_c":2.3,"vit_k":1.8}'::jsonb),
      ('169080', 'Cheese, pasteurized process, American, low fat', '{"vit_e":0.27,"sugar":0.59,"vit_k":2.7,"b12":0.77,"vit_a":57,"vit_c":0,"b1":0.03,"b2":0.39,"cholesterol":35,"sat_fat":4.41,"vit_d":0.1,"protein":24.6,"copper":0.033,"fiber":0,"iron":0.43,"magnesium":24,"phosphorus":827,"fat":7,"carb":3.5,"kcal":180,"calcium":684,"potassium":180,"zinc":3.32,"folate":9,"b3":0.08,"b6":0.08,"sodium":1790,"selenium":16.6}'::jsonb),
      ('175237', 'Beans, black, mature seeds, cooked, boiled, with salt', '{"folate":149,"fiber":8.7,"vit_a":0,"trans_fat":0,"vit_d":0,"vit_e":0.87,"sugar":0.32,"vit_k":3.3,"iron":2.1,"magnesium":70,"phosphorus":140,"sodium":237,"copper":0.209,"manganese":0.444,"protein":8.86,"cholesterol":0,"sat_fat":0.139,"vit_c":0,"b1":0.244,"b2":0.059,"b12":0,"fat":0.54,"carb":23.7,"kcal":132,"b3":0.505,"b6":0.069,"calcium":27,"potassium":355,"zinc":1.12,"selenium":1.2}'::jsonb)
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
    and source_id in ('169698', '169736', '170848', '746782', '328637', '2020713', '2346411', '173944', '171706', '174493', '170043', '172183', '2676733', '171287', '172370', '1851245', '2346397', '170471', '173263', '171052', '169080', '175237')
),
recipes as (
  insert into public.foods (user_id, name, source, recipe_servings, serving_qty, serving_unit, nutrients)
  values
    ((select uid from me), 'Homemade Mac N Cheese', 'recipe', 3, 1, 'serving', '{"kcal":519,"protein":31,"carb":56,"fat":21,"fiber":7,"sugar":5,"sat_fat":13,"trans_fat":0,"cholesterol":52,"sodium":379,"potassium":100,"calcium":585,"iron":0.54,"vit_a":90,"vit_c":0}'::jsonb),
    ((select uid from me), 'Homemade Smoothie', 'recipe', 1, 1, 'serving', '{"kcal":322,"protein":16,"carb":35,"fat":14,"fiber":6,"sugar":17,"sat_fat":6,"trans_fat":0,"cholesterol":30,"sodium":109,"potassium":758,"calcium":468,"iron":0.9,"vit_a":27,"vit_c":18.9}'::jsonb),
    ((select uid from me), 'Breakfast Burrito (Eggs, Cheese, Potato, Bacon)', 'recipe', 1, 1, 'serving', '{"kcal":458,"protein":38,"carb":41,"fat":24,"fiber":25,"sugar":0,"sat_fat":8,"trans_fat":0,"cholesterol":258,"sodium":836,"potassium":184,"calcium":286,"iron":2.52,"vit_a":45,"vit_c":0}'::jsonb),
    ((select uid from me), 'Homemade Oatmeal', 'recipe', 1, 1, 'serving', '{"kcal":331,"protein":11,"carb":38,"fat":15,"fiber":7,"sugar":8,"sat_fat":3,"trans_fat":0,"cholesterol":10,"sodium":35,"potassium":202,"calcium":169,"iron":2.34,"vit_a":0,"vit_c":6.3}'::jsonb),
    ((select uid from me), 'Burrito Bowl', 'recipe', 6, 1, 'serving', '{"kcal":481,"protein":41,"carb":62,"fat":6,"fiber":11,"sugar":3,"sat_fat":1,"trans_fat":0,"cholesterol":82,"sodium":781,"potassium":767,"calcium":481,"iron":2.52,"vit_a":918,"vit_c":36}'::jsonb)
  returning id, name
)
insert into public.recipe_ingredients (user_id, recipe_food_id, ingredient_food_id, servings)
select (select uid from me), r.id, i.id, li.servings
from (values
    ('Homemade Mac N Cheese', '169698', 0.1),
    ('Homemade Mac N Cheese', '169736', 2.24),
    ('Homemade Mac N Cheese', '170848', 0.15),
    ('Homemade Mac N Cheese', '746782', 2.44),
    ('Homemade Mac N Cheese', '328637', 1.4),
    ('Homemade Smoothie', '2020713', 0.1),
    ('Homemade Smoothie', '2346411', 0.74),
    ('Homemade Smoothie', '173944', 0.59),
    ('Homemade Smoothie', '171706', 0.38),
    ('Homemade Smoothie', '746782', 2.44),
    ('Breakfast Burrito (Eggs, Cheese, Potato, Bacon)', '174493', 0.77),
    ('Breakfast Burrito (Eggs, Cheese, Potato, Bacon)', '170043', 0.3),
    ('Breakfast Burrito (Eggs, Cheese, Potato, Bacon)', '172183', 0.46),
    ('Breakfast Burrito (Eggs, Cheese, Potato, Bacon)', '2676733', 0.71),
    ('Breakfast Burrito (Eggs, Cheese, Potato, Bacon)', '328637', 0.14),
    ('Breakfast Burrito (Eggs, Cheese, Potato, Bacon)', '171287', 0.5),
    ('Breakfast Burrito (Eggs, Cheese, Potato, Bacon)', '172370', 0.03),
    ('Homemade Oatmeal', '1851245', 0.14),
    ('Homemade Oatmeal', '2346397', 0.45),
    ('Homemade Oatmeal', '746782', 0.81),
    ('Homemade Oatmeal', '2346411', 0.49),
    ('Burrito Bowl', '170471', 5.4),
    ('Burrito Bowl', '173263', 2.7),
    ('Burrito Bowl', '171052', 6.8),
    ('Burrito Bowl', '169080', 1.26),
    ('Burrito Bowl', '175237', 3.9),
    ('Burrito Bowl', '172370', 0.14)
) as li(recipe_name, source_id, servings)
join recipes r on r.name = li.recipe_name
join ing i on i.source_id = li.source_id;
