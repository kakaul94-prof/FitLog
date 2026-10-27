package app.fitlog.e2e.pages;

/** The diary's four meals: the key the database stores and the label the screen shows. */
public enum Meal {
  BREAKFAST("breakfast", "Breakfast"),
  LUNCH("lunch", "Lunch"),
  DINNER("dinner", "Dinner"),
  SNACKS("snacks", "Snacks");

  private final String key;
  private final String label;

  Meal(String key, String label) {
    this.key = key;
    this.label = label;
  }

  public String key() {
    return key;
  }

  public String label() {
    return label;
  }

  /** The label, so report steps read "Expect Dinner to total 350 cal", not "DINNER". */
  @Override
  public String toString() {
    return label;
  }

  /** "Lunch" or "lunch" → LUNCH (used by the Cucumber steps). */
  public static Meal fromText(String text) {
    for (Meal meal : values()) {
      if (meal.label.equalsIgnoreCase(text.trim())) return meal;
    }
    throw new IllegalArgumentException("Unknown meal: " + text);
  }
}
