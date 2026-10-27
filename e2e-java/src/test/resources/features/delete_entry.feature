@regression
Feature: Deleting a diary entry
  Deleting an entry asks for confirmation, then removes it
  from the diary and from the database, leaving other entries alone.

  Background:
    Given I am signed in as a new user

  Scenario: Deleting an entry removes it from the diary and the database
    Given "Toast" with 180 calories is already logged to Breakfast today
    When I delete the entry "Toast"
    Then the diary no longer shows "Toast"
    And no entry named "Toast" remains saved

  Scenario: Deleting one entry keeps the others
    Given "Eggs" with 140 calories is already logged to Breakfast today
    And "Bacon" with 90 calories is already logged to Breakfast today
    When I delete the entry "Bacon"
    Then the diary no longer shows "Bacon"
    And the diary still shows "Eggs" with 140 calories
