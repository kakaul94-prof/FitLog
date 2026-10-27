package app.fitlog.e2e.tests;

import static org.assertj.core.api.Assertions.assertThat;

import app.fitlog.e2e.pages.DiaryPage;
import app.fitlog.e2e.pages.LoginPage;
import app.fitlog.e2e.support.TestUser;
import io.qameta.allure.Feature;
import io.qameta.allure.Severity;
import io.qameta.allure.SeverityLevel;
import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

/** Signing in: the one journey every other test depends on. */
@Feature("Sign in")
public class LoginTest extends BaseUiTest {

  /** Which credentials a row uses, resolved against the test's own freshly created user. */
  enum Credentials {
    OWN,
    WRONG_PASSWORD,
    EMPTY;

    String email(TestUser user) {
      return this == EMPTY ? "" : user.email();
    }

    String password(TestUser user) {
      return switch (this) {
        case OWN -> user.password();
        case WRONG_PASSWORD -> "not-" + user.password();
        case EMPTY -> "";
      };
    }
  }

  enum Outcome {
    SIGNED_IN,
    ERROR_SHOWN,
    FORM_BLOCKS_SUBMIT
  }

  @DataProvider(name = "credentials")
  public Object[][] credentials() {
    return new Object[][] {
      {"valid credentials", Credentials.OWN, Outcome.SIGNED_IN},
      {"wrong password", Credentials.WRONG_PASSWORD, Outcome.ERROR_SHOWN},
      {"empty fields", Credentials.EMPTY, Outcome.FORM_BLOCKS_SUBMIT},
    };
  }

  @Test(
      dataProvider = "credentials",
      groups = {"smoke", "regression"},
      description = "Sign in with valid, wrong-password and empty credentials")
  @Severity(SeverityLevel.BLOCKER)
  public void signIn(String title, Credentials credentials, Outcome expected) {
    LoginPage login = new LoginPage(driver()).open();

    login.signIn(credentials.email(user()), credentials.password(user()));

    switch (expected) {
      case SIGNED_IN -> {
        new DiaryPage(driver()).waitUntilLoaded();
        assertThat(login.isShown()).as("sign-in form gone after a valid sign-in").isFalse();
      }
      case ERROR_SHOWN -> {
        assertThat(login.errorMessage()).isEqualTo("Invalid login credentials");
        assertThat(login.isShown()).as("still on the sign-in form").isTrue();
      }
      case FORM_BLOCKS_SUBMIT -> {
        // The browser's own `required` check stops the submit: no request, no app error.
        assertThat(login.emailValidationMessage()).as("browser validation message").isNotEmpty();
        assertThat(login.hasError()).as("no app error for an unsent form").isFalse();
        assertThat(login.isShown()).isTrue();
      }
    }
  }
}
