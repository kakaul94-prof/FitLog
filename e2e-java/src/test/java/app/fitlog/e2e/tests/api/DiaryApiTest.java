package app.fitlog.e2e.tests.api;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.is;

import app.fitlog.e2e.api.FitLogApi;
import app.fitlog.e2e.pages.Meal;
import app.fitlog.e2e.support.RunId;
import app.fitlog.e2e.support.TestUser;
import io.qameta.allure.Feature;
import io.qameta.allure.Severity;
import io.qameta.allure.SeverityLevel;
import java.time.LocalDate;
import java.util.Map;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

/**
 * The data API (Supabase PostgREST) called directly with REST Assured: what the app's requests
 * must get back, and what a signed-out visitor or another user must not. No browser involved.
 */
@Feature("Data API")
public class DiaryApiTest {

  private static final LocalDate DAY = LocalDate.of(2024, 3, 5);

  // ThreadLocals, not fields: TestNG runs these methods in parallel on one instance.
  private static final ThreadLocal<TestUser> OWNER = new ThreadLocal<>();
  private static final ThreadLocal<TestUser> INTRUDER = new ThreadLocal<>();

  @BeforeMethod(alwaysRun = true)
  public void createUsers() {
    OWNER.set(TestUser.create("api-owner"));
    INTRUDER.set(TestUser.create("api-intruder"));
  }

  @AfterMethod(alwaysRun = true)
  public void deleteUsers() {
    for (ThreadLocal<TestUser> slot : java.util.List.of(OWNER, INTRUDER)) {
      TestUser user = slot.get();
      slot.remove();
      if (user != null) user.delete();
    }
  }

  private static Map<String, Object> entryBody(String name) {
    return Map.of(
        "entry_date", DAY.toString(),
        "meal", Meal.LUNCH.key(),
        "food_name", name,
        "nutrients", Map.of("kcal", 320),
        "servings", 1.5);
  }

  @Test(groups = "smoke", description = "Create a diary entry, then read it back field by field")
  @Severity(SeverityLevel.CRITICAL)
  public void createEntryThenReadItBack() {
    String name = RunId.unique("Burrito");

    String id =
        given()
            .spec(OWNER.get().api().spec())
            .header("Prefer", "return=representation")
            .body(entryBody(name))
            .post("/diary_entries")
            .then()
            .statusCode(201)
            .body("[0].food_name", equalTo(name))
            .body("[0].user_id", equalTo(OWNER.get().id()))
            .extract()
            .path("[0].id");

    given()
        .spec(OWNER.get().api().spec())
        .queryParam("id", "eq." + id)
        .get("/diary_entries")
        .then()
        .statusCode(200)
        .body("size()", is(1))
        .body("[0].food_name", equalTo(name))
        .body("[0].meal", equalTo("lunch"))
        .body("[0].entry_date", equalTo(DAY.toString()))
        .body("[0].servings", equalTo(1.5f))
        .body("[0].nutrients.kcal", equalTo(320))
        .body("[0].user_id", equalTo(OWNER.get().id()));
  }

  @Test(groups = "smoke", description = "A signed-out visitor cannot write: 401")
  @Severity(SeverityLevel.BLOCKER)
  public void anonymousInsertIsRejected() {
    given()
        .spec(FitLogApi.anonSpec())
        .body(entryBody(RunId.unique("Anon")))
        .post("/diary_entries")
        .then()
        .statusCode(401);

    assertThat(OWNER.get().api().diaryEntries(DAY)).as("nothing was written").isEmpty();
  }

  @Test(groups = "regression", description = "Another user can neither read nor delete my entry")
  @Severity(SeverityLevel.BLOCKER)
  public void anotherUserCannotReachMyEntry() {
    String name = RunId.unique("Private");
    String id = OWNER.get().api().addDiaryEntry(DAY, Meal.LUNCH, name, 320, 1);

    // Row-level security filters, it does not refuse: the intruder sees an empty list...
    given()
        .spec(INTRUDER.get().api().spec())
        .queryParam("id", "eq." + id)
        .get("/diary_entries")
        .then()
        .statusCode(200)
        .body("size()", is(0));

    // ...and their delete matches no rows, so it is a no-op.
    given()
        .spec(INTRUDER.get().api().spec())
        .queryParam("id", "eq." + id)
        .delete("/diary_entries")
        .then()
        .statusCode(204);

    assertThat(OWNER.get().api().diaryEntry(id)).as("the owner's row is untouched").isPresent();
  }
}
