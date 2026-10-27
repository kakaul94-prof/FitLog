package app.fitlog.e2e.tests;

import static org.assertj.core.api.Assertions.assertThat;

import app.fitlog.e2e.pages.DiaryPage;
import app.fitlog.e2e.pages.EntryPage;
import app.fitlog.e2e.pages.Meal;
import app.fitlog.e2e.support.RunId;
import io.qameta.allure.Feature;
import io.qameta.allure.Severity;
import io.qameta.allure.SeverityLevel;
import java.util.Map;
import org.testng.annotations.Test;

/** Editing and deleting a logged food. Each test seeds its own entry through the API. */
@Feature("Diary entries")
public class EntryTest extends BaseUiTest {

  @Test(groups = "regression", description = "Editing servings rescales the entry's calories")
  @Severity(SeverityLevel.NORMAL)
  public void editingServingsUpdatesCalories() {
    String food = RunId.unique("Yogurt");
    String id = api().addDiaryEntry(today(), Meal.BREAKFAST, food, 150, 1);

    DiaryPage diary = signIn();
    diary.waitForEntry(food, 150);
    EntryPage entry = diary.openEntry(food);
    entry.setServings("2");
    diary = entry.saveChanges();

    diary.waitForEntry(food, 300);
    Map<String, Object> saved =
        api().eventually("servings saved", a -> a.diaryEntry(id).orElse(null));
    assertThat(((Number) saved.get("servings")).doubleValue()).isEqualTo(2.0);
  }

  @Test(groups = "regression", description = "Changing the meal moves the entry and saves at once")
  @Severity(SeverityLevel.NORMAL)
  public void changingMealMovesEntry() {
    String food = RunId.unique("Soup");
    String id = api().addDiaryEntry(today(), Meal.LUNCH, food, 220, 1);

    DiaryPage diary = signIn();
    EntryPage entry = diary.openEntry(food);
    entry.changeMeal(Meal.DINNER);
    diary = entry.back();

    diary.waitForMealCalories(Meal.DINNER, 220);
    Map<String, Object> saved = api().eventually("meal saved", a -> a.diaryEntry(id).orElse(null));
    assertThat(saved).containsEntry("meal", "dinner");
  }

  @Test(groups = "smoke", description = "Delete (with its confirm dialog) removes the entry from the diary and the database")
  @Severity(SeverityLevel.CRITICAL)
  public void deleteEntryRemovesIt() {
    String food = RunId.unique("Cookie");
    String id = api().addDiaryEntry(today(), Meal.SNACKS, food, 90, 1);

    DiaryPage diary = signIn();
    EntryPage entry = diary.openEntry(food);
    diary = entry.delete();

    diary.waitForEntryGone(food);
    api().eventually("row deleted", a -> a.diaryEntry(id).isEmpty() ? Boolean.TRUE : null);
    assertThat(api().diaryEntries(today())).isEmpty();
  }
}
