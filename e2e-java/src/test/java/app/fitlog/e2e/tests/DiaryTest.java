package app.fitlog.e2e.tests;

import static org.assertj.core.api.Assertions.assertThat;

import app.fitlog.e2e.pages.DiaryPage;
import app.fitlog.e2e.pages.FoodPickerPage;
import app.fitlog.e2e.pages.Meal;
import app.fitlog.e2e.support.RunId;
import io.qameta.allure.Feature;
import io.qameta.allure.Severity;
import io.qameta.allure.SeverityLevel;
import java.time.LocalDate;
import java.util.Map;
import org.testng.annotations.Test;

/** The food diary: logging an entry and the totals it feeds. */
@Feature("Diary")
public class DiaryTest extends BaseUiTest {

  @Test(groups = "smoke", description = "Quick add logs a food to a meal and it is saved")
  @Severity(SeverityLevel.CRITICAL)
  public void quickAddEntryIsSaved() {
    String food = RunId.unique("Oats");

    DiaryPage diary = signIn();
    FoodPickerPage picker = diary.addFoodTo(Meal.LUNCH);
    picker.quickAdd(Meal.LUNCH, food, 210);
    diary = picker.done();

    diary.waitForEntry(food, 210);
    diary.waitForMealCalories(Meal.LUNCH, 210);

    // The UI is optimistic, so poll the database for the row rather than reading it once.
    Map<String, Object> saved =
        api()
            .eventually(
                "entry " + food + " reaches the database",
                a ->
                    a.diaryEntries(today()).stream()
                        .filter(e -> food.equals(e.get("food_name")))
                        .findFirst()
                        .orElse(null));
    assertThat(saved).containsEntry("meal", "lunch");
    assertThat(((Number) saved.get("servings")).doubleValue()).isEqualTo(1.0);
    assertThat(((Map<?, ?>) saved.get("nutrients")).get("kcal")).isEqualTo(210);
  }

  @Test(groups = "regression", description = "Meal and day totals follow what is logged")
  @Severity(SeverityLevel.CRITICAL)
  public void mealAndDayTotalsUpdate() {
    LocalDate day = LocalDate.of(2024, 3, 5);
    api().setManualCalorieGoal(2000);
    api().addDiaryEntry(day, Meal.DINNER, RunId.unique("Rice"), 200, 1);
    api().addDiaryEntry(day, Meal.DINNER, RunId.unique("Beans"), 150, 1);

    DiaryPage diary = signIn().openDate(day);
    diary.waitForMealCalories(Meal.DINNER, 350);
    diary.waitForRemaining(2000 - 350);

    String snack = RunId.unique("Apple");
    FoodPickerPage picker = diary.addFoodTo(Meal.SNACKS);
    picker.quickAdd(Meal.SNACKS, snack, 100);
    diary = picker.done();

    diary.waitForMealCalories(Meal.SNACKS, 100);
    diary.waitForMealCalories(Meal.DINNER, 350);
    diary.waitForRemaining(2000 - 450);
  }
}
