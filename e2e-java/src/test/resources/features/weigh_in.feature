@smoke
Feature: Logging a weigh-in
  A signed-in user logs today's body weight on the Progress tab
  and it appears in the weigh-in history.

  Scenario: A weigh-in appears in the history
    Given I am signed in as a new user
    When I log a weight of "176.8" lb on the Progress tab
    Then the weigh-in history shows "176.8" lb
    And a weigh-in of "176.8" lb is saved
