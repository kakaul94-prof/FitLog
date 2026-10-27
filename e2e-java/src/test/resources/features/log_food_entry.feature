@smoke
Feature: Logging a food entry
  A signed-in user records what they ate with Quick add,
  and the diary shows it under the right meal with its calories.

  Background:
    Given I am signed in as a new user

  Scenario: Quick add saves a food to a meal
    When I quick add "Oats" with 210 calories to Lunch
    Then the diary shows "Oats" with 210 calories under Lunch
    And the entry "Oats" is saved with 210 calories in Lunch
