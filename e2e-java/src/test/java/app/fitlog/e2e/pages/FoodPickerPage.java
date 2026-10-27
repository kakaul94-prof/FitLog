package app.fitlog.e2e.pages;

import io.qameta.allure.Step;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;

/** The "Add to {meal}" food picker (/diary/add): search, Quick add, Done. */
public class FoodPickerPage extends BasePage {

  private final By quickAddButton = buttonWithText("Quick add");
  private final By doneButton = buttonWithText("Done");
  private final By quickAddName = By.id("qa-name");
  private final By quickAddCalories = By.id("qa-kcal");

  public FoodPickerPage(WebDriver driver) {
    super(driver);
  }

  public FoodPickerPage waitUntilLoaded() {
    visible(quickAddButton);
    return this;
  }

  /**
   * Log a calories-only entry through the Quick add sheet. Returns once the "Added …" toast is
   * on screen. The picker is optimistic (the toast shows before the insert has landed), so a
   * test that reads the database straight after should use {@code FitLogApi.eventually}.
   */
  @Step("Quick add {name} ({kcal} cal) to {meal}")
  public void quickAdd(Meal meal, String name, int kcal) {
    click(quickAddButton);
    // The picker names the meal by its key ("Quick add to lunch"), unlike the diary's headers.
    visible(textExact("Quick add to " + meal.key()));
    fill(quickAddName, name);
    fill(quickAddCalories, String.valueOf(kcal));
    click(buttonWithText("Add to " + meal.key()));
    visible(textExact("Added " + name));
  }

  /** Back to the diary. */
  @Step("Tap Done")
  public DiaryPage done() {
    click(doneButton);
    return new DiaryPage(driver).waitUntilLoaded();
  }
}
