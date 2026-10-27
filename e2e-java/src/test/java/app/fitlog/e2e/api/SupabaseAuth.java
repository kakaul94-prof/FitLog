package app.fitlog.e2e.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.anyOf;
import static org.hamcrest.Matchers.is;

import app.fitlog.e2e.config.Config;
import io.restassured.http.ContentType;
import io.restassured.path.json.JsonPath;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.util.Map;

/**
 * Supabase Auth (GoTrue) over REST Assured.
 *
 * <p>Two roles, kept apart on purpose: the service-role key creates and deletes test users
 * (fixtures only), while sign-in uses the public anon key, exactly as the app does, so every
 * token a test uses is a genuine user token.
 *
 * <p>None of these calls is attached to the Allure report: they are test setup, not behaviour
 * under test, and their bodies carry passwords and tokens.
 */
public final class SupabaseAuth {

  private final String url = Config.supabaseUrl();

  private RequestSpecification admin() {
    String key = Config.serviceRoleKey();
    return given()
        .baseUri(url)
        .basePath("/auth/v1")
        .header("apikey", key)
        .header("Authorization", "Bearer " + key)
        .contentType(ContentType.JSON);
  }

  private RequestSpecification anon() {
    return given()
        .baseUri(url)
        .basePath("/auth/v1")
        .header("apikey", Config.anonKey())
        .contentType(ContentType.JSON);
  }

  /** Create a confirmed user and return its id. */
  public String createUser(String email, String password) {
    return admin()
        .body(Map.of("email", email, "password", password, "email_confirm", true))
        .post("/admin/users")
        .then()
        .statusCode(200)
        .extract()
        .path("id");
  }

  /** Delete a user; every row they own goes with them (foreign keys cascade). */
  public void deleteUser(String userId) {
    admin()
        .delete("/admin/users/{id}", userId)
        .then()
        .statusCode(anyOf(is(200), is(204), is(404)));
  }

  /** Sign in with a password and return the session. Fails the test if sign-in is refused. */
  public Session signIn(String email, String password) {
    JsonPath body = signInResponse(email, password).then().statusCode(200).extract().jsonPath();
    return new Session(body.getString("user.id"), email, body.getString("access_token"));
  }

  /** The raw sign-in response, for tests that assert on a refusal. */
  public Response signInResponse(String email, String password) {
    return anon()
        .queryParam("grant_type", "password")
        .body(Map.of("email", email, "password", password))
        .post("/token");
  }
}
