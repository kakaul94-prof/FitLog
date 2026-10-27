package app.fitlog.e2e.tests;

import app.fitlog.e2e.api.FitLogApi;
import app.fitlog.e2e.driver.DriverFactory;
import app.fitlog.e2e.pages.DiaryPage;
import app.fitlog.e2e.pages.LoginPage;
import app.fitlog.e2e.support.FailureEvidence;
import app.fitlog.e2e.support.TestUser;
import java.time.LocalDate;
import java.util.Locale;
import org.openqa.selenium.WebDriver;
import org.testng.ITestResult;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;

/**
 * Setup and teardown shared by every UI test.
 *
 * <p>Before each test: a fresh user and a fresh browser. After it: a screenshot and the page URL
 * if it failed, then the browser is closed and the user deleted (which removes every row the
 * test created). Both live in ThreadLocals rather than fields because TestNG runs the methods
 * of one class instance on several threads at once; a plain field would be shared between them.
 */
public abstract class BaseUiTest {

  private static final ThreadLocal<TestUser> USER = new ThreadLocal<>();

  @BeforeMethod(alwaysRun = true)
  public void startUserAndBrowser() {
    USER.set(TestUser.create(label()));
    DriverFactory.start();
  }

  @AfterMethod(alwaysRun = true)
  public void captureEvidenceAndTearDown(ITestResult result) {
    try {
      if (!result.isSuccess() && DriverFactory.hasDriver()) {
        FailureEvidence.capture(driver(), result.getMethod().getQualifiedName());
      }
    } finally {
      DriverFactory.quit();
      TestUser user = USER.get();
      USER.remove();
      if (user != null) user.delete();
    }
  }

  /** This thread's browser. */
  protected WebDriver driver() {
    return DriverFactory.current();
  }

  /** This test's user. */
  protected TestUser user() {
    return USER.get();
  }

  /** This test's data API, for setup rows and for checking what reached the database. */
  protected FitLogApi api() {
    return user().api();
  }

  /** Sign in through the real form as this test's user and land on the diary. */
  protected DiaryPage signIn() {
    new LoginPage(driver()).open().signIn(user().email(), user().password());
    return new DiaryPage(driver()).waitUntilLoaded();
  }

  /** Today as the app sees it: the browser and the tests share one machine and time zone. */
  protected static LocalDate today() {
    return LocalDate.now();
  }

  /** The test area, for the user's email: "DiaryTest" → "diary". */
  private String label() {
    return getClass().getSimpleName().replace("Test", "").toLowerCase(Locale.ROOT);
  }
}
