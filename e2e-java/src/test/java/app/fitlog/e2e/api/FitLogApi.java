package app.fitlog.e2e.api;

import static io.restassured.RestAssured.given;

import app.fitlog.e2e.config.Config;
import app.fitlog.e2e.pages.Meal;
import io.qameta.allure.restassured.AllureRestAssured;
import io.restassured.common.mapper.TypeRef;
import io.restassured.config.LogConfig;
import io.restassured.config.RestAssuredConfig;
import io.restassured.http.ContentType;
import io.restassured.specification.RequestSpecification;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import org.openqa.selenium.support.ui.FluentWait;

/**
 * FitLog's data API (Supabase PostgREST) as one signed-in user, under the same anon key and
 * row-level-security rules the app runs with.
 *
 * <p>Tests use it two ways: to set up starting data quickly and exactly (an entry to edit, a
 * goal so the calorie ring shows), and as the source of truth for what actually reached the
 * database after a journey through the UI.
 */
public final class FitLogApi {

  private final Session session;

  public FitLogApi(Session session) {
    this.session = session;
  }

  public Session session() {
    return session;
  }

  /** A request as this user: anon key + the user's bearer token, logged to the Allure report. */
  public RequestSpecification spec() {
    return anonSpec().header("Authorization", "Bearer " + session.accessToken());
  }

  /**
   * A request with only the public anon key, i.e. a signed-out visitor. Every request and
   * response is attached to the Allure report, with the key and token headers blacklisted so
   * they show as "[ BLACKLISTED ]" rather than in clear.
   */
  public static RequestSpecification anonSpec() {
    return given()
        .config(
            RestAssuredConfig.config()
                .logConfig(LogConfig.logConfig().blacklistHeader("Authorization", "apikey")))
        .baseUri(Config.supabaseUrl())
        .basePath("/rest/v1")
        .header("apikey", Config.anonKey())
        .contentType(ContentType.JSON)
        .accept(ContentType.JSON)
        .filter(new AllureRestAssured());
  }

  // ---- diary -----------------------------------------------------------------------------

  /** A calories-only diary entry saved straight to the server; returns its id. */
  public String addDiaryEntry(LocalDate date, Meal meal, String name, int kcal, double servings) {
    return spec()
        .header("Prefer", "return=representation")
        .body(
            Map.of(
                "entry_date", date.toString(),
                "meal", meal.key(),
                "food_name", name,
                "nutrients", Map.of("kcal", kcal),
                "servings", servings))
        .post("/diary_entries")
        .then()
        .statusCode(201)
        .extract()
        .path("[0].id");
  }

  /** A day's entries as saved: id, food_name, meal, servings, nutrients. */
  public List<Map<String, Object>> diaryEntries(LocalDate date) {
    return spec()
        .queryParam("entry_date", "eq." + date)
        .queryParam("select", "id,food_name,meal,servings,nutrients")
        .queryParam("order", "food_name")
        .get("/diary_entries")
        .then()
        .statusCode(200)
        .extract()
        .as(new TypeRef<>() {});
  }

  public Optional<Map<String, Object>> diaryEntry(String id) {
    List<Map<String, Object>> rows =
        spec()
            .queryParam("id", "eq." + id)
            .queryParam("select", "id,food_name,meal,servings,nutrients,entry_date")
            .get("/diary_entries")
            .then()
            .statusCode(200)
            .extract()
            .as(new TypeRef<>() {});
    return rows.stream().findFirst();
  }

  // ---- weigh-ins -------------------------------------------------------------------------

  public void addWeighIn(LocalDate date, String lb) {
    spec()
        .body(Map.of("measured_on", date.toString(), "type", "weight", "value", new BigDecimal(lb)))
        .post("/measurements")
        .then()
        .statusCode(201);
  }

  /** Weigh-ins as saved: measured_on, value (a number). */
  public List<Map<String, Object>> weighIns() {
    return spec()
        .queryParam("type", "eq.weight")
        .queryParam("select", "measured_on,value")
        .get("/measurements")
        .then()
        .statusCode(200)
        .extract()
        .as(new TypeRef<>() {});
  }

  // ---- profile ---------------------------------------------------------------------------

  /** Give the user a fixed daily calorie target so the diary's ring shows "N calories remaining". */
  public void setManualCalorieGoal(int kcal) {
    spec()
        .queryParam("id", "eq." + session.userId())
        .body(Map.of("calorie_goal_mode", "manual", "manual_calorie_goal", kcal))
        .patch("/profiles")
        .then()
        .statusCode(204);
  }

  // ---- eventual consistency --------------------------------------------------------------

  /**
   * Poll the API until {@code probe} returns a non-null value, or fail after the configured
   * timeout. The same explicit-wait idea as WebDriverWait, applied to the database: the UI can be
   * optimistic (a toast before the insert lands), so a read straight after a tap could race it.
   */
  public <T> T eventually(String description, Function<FitLogApi, T> probe) {
    return new FluentWait<>(this)
        .withTimeout(Config.timeout())
        .pollingEvery(Duration.ofMillis(200))
        .withMessage(description)
        .until(probe::apply);
  }
}
