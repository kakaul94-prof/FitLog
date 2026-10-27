package app.fitlog.e2e.support;

import app.fitlog.e2e.api.FitLogApi;
import app.fitlog.e2e.api.Session;
import app.fitlog.e2e.api.SupabaseAuth;
import io.qameta.allure.Step;

/**
 * A user that exists only for one test.
 *
 * <p>Same pattern as the Python API suite: created through the Auth admin API with the
 * service-role key, signed in through the real password endpoint, and deleted at the end, which
 * cascades to every row the user owns. That one delete is the whole cleanup, and no two tests
 * ever share an account, so they are independent and safe to run in parallel or in any order.
 */
public final class TestUser {

  private final SupabaseAuth auth;
  private final String id;
  private final String email;
  private final String password;
  private final FitLogApi api;

  private TestUser(SupabaseAuth auth, String id, String email, String password, Session session) {
    this.auth = auth;
    this.id = id;
    this.email = email;
    this.password = password;
    this.api = new FitLogApi(session);
  }

  /** Create and sign in a fresh user; {@code label} names the test area in the email. */
  @Step("Create test user ({label})")
  public static TestUser create(String label) {
    SupabaseAuth auth = new SupabaseAuth();
    String email = RunId.unique("java-" + label) + "@api.test";
    String password = RunId.password();
    String id = auth.createUser(email, password);
    Session session = auth.signIn(email, password);
    return new TestUser(auth, id, email, password, session);
  }

  public String id() {
    return id;
  }

  public String email() {
    return email;
  }

  public String password() {
    return password;
  }

  /** This user's data API, for setup and for checking what reached the database. */
  public FitLogApi api() {
    return api;
  }

  /** Delete the user and, through cascading foreign keys, everything they logged. */
  @Step("Delete the test user and everything they logged")
  public void delete() {
    auth.deleteUser(id);
  }
}
