package app.fitlog.e2e.pages;

import io.qameta.allure.Step;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.Select;

/**
 * Editing one logged food (/diary/entry/:id). Changing the meal saves at once; servings wait
 * for "Save changes"; Delete asks with a native confirm() dialog.
 */
public class EntryPage extends BasePage {

  private final By servingsInput = By.id("srv");
  private final By mealSelect = By.id("entry-meal");
  private final By saveChangesButton = buttonWithText("Save changes");
  private final By deleteButton = buttonWithText("Delete entry");
  private final By backButton = By.cssSelector("button[aria-label='Back']");

  public EntryPage(WebDriver driver) {
    super(driver);
  }

  public EntryPage waitUntilLoaded() {
    visible(servingsInput);
    return this;
  }

  @Step("Set servings to {servings}")
  public void setServings(String servings) {
    fill(servingsInput, servings);
  }

  public String servings() {
    return visible(servingsInput).getDomProperty("value");
  }

  /** Save the servings change; the app returns to the diary. */
  @Step("Save changes")
  public DiaryPage saveChanges() {
    click(saveChangesButton);
    return new DiaryPage(driver).waitUntilLoaded();
  }

  /** Pick another meal; this saves immediately, with no Save button. */
  @Step("Change meal to {meal}")
  public void changeMeal(Meal meal) {
    new Select(visible(mealSelect)).selectByValue(meal.key());
  }

  public String selectedMeal() {
    return new Select(visible(mealSelect)).getFirstSelectedOption().getDomProperty("value");
  }

  @Step("Go back to the diary")
  public DiaryPage back() {
    click(backButton);
    return new DiaryPage(driver).waitUntilLoaded();
  }

  /** Delete the entry, accepting the browser's confirm() dialog; the app returns to the diary. */
  @Step("Delete the entry and accept the confirm dialog")
  public DiaryPage delete() {
    click(deleteButton);
    wait.until(ExpectedConditions.alertIsPresent()).accept();
    return new DiaryPage(driver).waitUntilLoaded();
  }
}
