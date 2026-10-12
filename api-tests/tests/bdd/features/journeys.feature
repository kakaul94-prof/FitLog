Feature: Everyday journeys through the API
  The calls the app makes for a few common tasks, end to end, checking what
  the database keeps at each step. These are the rules the screens rely on.

  Background:
    Given Alice has a FitLog account

  Scenario: A logged day doesn't change when the food behind it does
    Given Alice has a food "Bagel" with 280 kcal per serving
    When she logs 1.5 servings of "Bagel" for breakfast on 2025-02-01
    Then her diary for 2025-02-01 shows "Bagel" with 1.5 servings and 280 kcal per serving
    When she deletes "Bagel" from her food library
    Then her diary for 2025-02-01 still shows "Bagel" with 1.5 servings and 280 kcal per serving

  Scenario: A recipe keeps the foods it is made from
    Given Alice has a food "Flour" with 364 kcal per serving
    And Alice has a food "Butter" with 717 kcal per serving
    When she makes a recipe "Shortbread" from "Flour" and "Butter"
    Then "Shortbread" lists 2 ingredients
    And "Flour" can't be deleted while "Shortbread" uses it
    When she deletes the recipe "Shortbread"
    Then "Flour" can be deleted

  Scenario: Logging and finishing a workout
    When she starts a workout on 2025-03-01
    And she logs 3 sets of 5 "Back Squat" at 225 lb
    And she marks the workout as done
    Then the workout is complete with 3 sets
    When she deletes the workout
    Then its sets are gone too

  Scenario: Weighing in and setting a calorie goal
    When she logs a weigh-in of 180.4 lb on 2025-01-15
    And she sets a manual calorie goal of 2200 kcal
    Then her latest weigh-in is 180.4 lb
    And her profile uses a manual goal of 2200 kcal
