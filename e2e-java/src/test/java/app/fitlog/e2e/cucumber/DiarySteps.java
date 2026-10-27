package app.fitlog.e2e.cucumber;

import static org.assertj.core.api.Assertions.assertThat;

import app.fitlog.e2e.pages.DiaryPage;
import app.fitlog.e2e.pages.FoodPickerPage;
import app.fitlog.e2e.pages.LoginPage;
import app.fitlog.e2e.pages.Meal;
import io.cucumber.java.en.Given;
import io.cucumber.java.en.Then;
import io.cucumber.java.en.When;
import java.time.LocalDate;
import java.util.Map;

/** Steps for the diary features. They call the same page objects as the TestNG tests. */
public class DiarySteps {

  private final ScenarioContext context;

  public DiarySteps(ScenarioContext context) {
    this.context = context;
  }

  private DiaryPage diary() {
    return new DiaryPage(context.driver());
  }

  @Given("I am signed in as a new user")
  public void signedIn() {
    new LoginPage(context.driver())
        .open()
        .signIn(context.user().email(), context.user().password());
    diary().waitUntilLoaded();
  }

  @Given("{string} with {int} calories is already logged to {word} today")
  public void entryAlreadyLogged(String food, int kcal, String meal) {
    context.user().api().addDiaryEntry(LocalDate.now(), Meal.fromText(meal), context.unique(food), kcal, 1);
    // A fresh load shows what the API wrote; it was seeded after the page opened.
    diary().openDate(LocalDate.now());
  }

  @When("I quick add {string} with {int} calories to {word}")
  public void quickAdd(String food, int kcal, String meal) {
    Meal target = Meal.fromText(meal);
    FoodPickerPage picker = diary().addFoodTo(target);
    picker.quickAdd(target, context.unique(food), kcal);
    picker.done();
  }

  @When("I delete the entry {string}")
  public void deleteEntry(String food) {
    diary().openEntry(context.unique(food)).delete();
  }

  @Then("the diary shows {string} with {int} calories under {word}")
  public void diaryShows(String food, int kcal, String meal) {
    diary().waitForEntry(context.unique(food), kcal);
    diary().waitForMealCalories(Meal.fromText(meal), kcal);
  }

  @Then("the diary no longer shows {string}")
  public void diaryNoLongerShows(String food) {
    diary().waitForEntryGone(context.unique(food));
  }

  @Then("the diary still shows {string} with {int} calories")
  public void diaryStillShows(String food, int kcal) {
    diary().waitForEntry(context.unique(food), kcal);
  }

  @Then("the entry {string} is saved with {int} calories in {word}")
  public void entryIsSaved(String food, int kcal, String meal) {
    String name = context.unique(food);
    Map<String, Object> saved =
        context
            .user()
            .api()
            .eventually(
                "entry " + name + " saved",
                a ->
                    a.diaryEntries(LocalDate.now()).stream()
                        .filter(e -> name.equals(e.get("food_name")))
                        .findFirst()
                        .orElse(null));
    assertThat(saved).containsEntry("meal", Meal.fromText(meal).key());
    assertThat(((Map<?, ?>) saved.get("nutrients")).get("kcal")).isEqualTo(kcal);
  }

  @Then("no entry named {string} remains saved")
  public void noEntryRemains(String food) {
    String name = context.unique(food);
    context
        .user()
        .api()
        .eventually(
            "entry " + name + " deleted",
            a ->
                a.diaryEntries(LocalDate.now()).stream().noneMatch(e -> name.equals(e.get("food_name")))
                    ? Boolean.TRUE
                    : null);
  }
}
