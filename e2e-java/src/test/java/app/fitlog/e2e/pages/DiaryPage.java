package app.fitlog.e2e.pages;

import io.qameta.allure.Step;
import java.time.LocalDate;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;

/** The Diary tab: the signed-in landing page with the day's meals, entries and calorie ring. */
public class DiaryPage extends BasePage {

  private final By heading = heading("Diary");
  // The calorie ring is an <svg role="img"> whose aria-label reads "N calories remaining".
  private final By calorieRing = By.cssSelector("svg[role='img'][aria-label$='calories remaining']");

  public DiaryPage(WebDriver driver) {
    super(driver);
  }

  public DiaryPage waitUntilLoaded() {
    visible(heading);
    return this;
  }

  /** Open the diary on a given day. */
  @Step("Open the diary for {date}")
  public DiaryPage openDate(LocalDate date) {
    open("/?date=" + date);
    return waitUntilLoaded();
  }

  // ---- meals -----------------------------------------------------------------------------

  /** The meal's row, whichever form it takes: an empty "{Meal} + Add" row or a header with a total. */
  private static String mealRow(Meal meal) {
    return "//button[.//span[normalize-space(text())=" + literal(meal.label()) + "]]";
  }

  /** The number before "cal" in a meal's header. */
  private static By mealTotal(Meal meal) {
    return By.xpath(mealRow(meal) + "//span[normalize-space(text())='cal']/span");
  }

  /** Open the food picker for a meal. */
  @Step("Open the food picker for {meal}")
  public FoodPickerPage addFoodTo(Meal meal) {
    By emptyMealRow = By.xpath(mealRow(meal) + "[.//span[normalize-space(text())='+ Add']]");
    By addFoodButton = By.xpath(mealRow(meal) + "/..//button[normalize-space(.)='Add food']");
    // Exactly one of the two renders once the day has loaded; wait for whichever it is.
    click(firstVisible(emptyMealRow, addFoodButton));
    return new FoodPickerPage(driver).waitUntilLoaded();
  }

  /** Wait until the meal's header total reads {@code kcal}. */
  @Step("Expect {meal} to total {kcal} cal")
  public void waitForMealCalories(Meal meal, int kcal) {
    wait.until(ExpectedConditions.textToBe(mealTotal(meal), String.valueOf(kcal)));
  }

  public int mealCalories(Meal meal) {
    return Integer.parseInt(textOf(mealTotal(meal)));
  }

  // ---- entries ---------------------------------------------------------------------------

  /** A logged entry's row: its name and its calories, as two cells of one tappable row. */
  private static By entryRow(String name) {
    return By.xpath("//button[.//div[normalize-space(text())=" + literal(name) + "]]");
  }

  private static By entryRow(String name, int kcal) {
    return By.xpath(
        "//button[.//div[normalize-space(text())="
            + literal(name)
            + "] and .//div[normalize-space(text())='"
            + kcal
            + "']]");
  }

  /** Wait for an entry row showing this name and calorie total. */
  @Step("Expect entry {name} showing {kcal} cal")
  public void waitForEntry(String name, int kcal) {
    visible(entryRow(name, kcal));
  }

  @Step("Expect entry {name} to be gone")
  public void waitForEntryGone(String name) {
    waitUntilGone(entryRow(name));
  }

  public boolean hasEntry(String name) {
    return isPresentNow(entryRow(name));
  }

  /** Tap an entry to edit it. */
  @Step("Open entry {name}")
  public EntryPage openEntry(String name) {
    click(entryRow(name));
    return new EntryPage(driver).waitUntilLoaded();
  }

  // ---- calorie ring ----------------------------------------------------------------------

  /** Wait until the ring reads "{kcal} calories remaining" (goal + exercise − food). */
  @Step("Expect {kcal} calories remaining")
  public void waitForRemaining(int kcal) {
    visible(By.cssSelector("svg[role='img'][aria-label='" + kcal + " calories remaining']"));
  }

  public String remainingLabel() {
    return visible(calorieRing).getDomAttribute("aria-label");
  }
}
