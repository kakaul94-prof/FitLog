Feature: Each person's data is theirs alone
  FitLog keeps a private food diary, training log and body measurements for
  every account. Another signed-in user, or someone who isn't signed in at
  all, must never be able to see, change, delete or add to them, whatever
  they send to the API.

  Background:
    Given Alice and Bob each have a FitLog account

  Scenario: Another user's logged meal never shows up in your search
    Given Alice has logged "Overnight oats" for breakfast
    When Bob searches his foods for "Overnight oats"
    Then Bob finds nothing
    When Bob searches his diary for "Overnight oats"
    Then Bob finds nothing
    And Alice's diary still has "Overnight oats" for breakfast

  Scenario Outline: Another user can't read, change or delete your <records>
    Given Alice has <records> saved
    When Bob tries to read Alice's <records>
    Then Bob finds nothing
    When Bob tries to change Alice's <records>
    Then Bob finds nothing
    When Bob tries to delete Alice's <records>
    Then Bob finds nothing
    And Alice's <records> are exactly as she left them

    Examples:
      | records        |
      | diary entries  |
      | foods          |
      | workouts       |
      | workout sets   |
      | weigh-ins      |
      | saved meals    |
      | exercise notes |
      | strength goals |

  Scenario: You can't save a weigh-in into someone else's account
    When Bob saves a weigh-in of 150 lb into Alice's account
    Then the API refuses it as a row-level security violation
    And Alice has no weigh-ins

  Scenario: You can't hang your sets off someone else's workout
    Given Alice has a workout
    When Bob logs a set against Alice's workout
    Then the API refuses the link to Alice's workout
    When Alice deletes her workout
    Then Bob's own sets are untouched

  Scenario: You can't use someone else's food in your recipe
    Given Alice has a food "Grandma's stew"
    When Bob adds Alice's food to one of his recipes
    Then the API refuses the link to Alice's food
    And Alice can still delete "Grandma's stew"

  Scenario: Another user can't watch your form-check videos
    Given Alice has uploaded a form-check video
    When Bob tries to download Alice's video
    Then the video is not found
    When Bob lists Alice's video folder
    Then Bob finds nothing

  Scenario: A signed-out visitor sees nothing at all
    Given Alice has logged "Greek yogurt" for breakfast
    When a signed-out visitor reads the diary
    Then the visitor finds nothing
    When a signed-out visitor tries to log "Greek yogurt" for breakfast
    Then the API refuses it as a row-level security violation
