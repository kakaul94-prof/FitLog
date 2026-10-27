package app.fitlog.e2e.support;

import app.fitlog.e2e.config.Config;
import app.fitlog.e2e.driver.DriverFactory;
import java.time.Duration;
import java.time.Instant;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.testng.ISuite;
import org.testng.ISuiteListener;

/**
 * Loads the app once, end to end, before any test runs (registered in testng.xml).
 *
 * <p>The app under test is the Vite dev server. On a cold start (every CI run, or locally after
 * {@code npm ci}) Vite compiles and bundles the app's dependencies on the first page loads, which
 * can take a minute. Without this, the first tests in the parallel wave would spend their
 * 10-second waits on the dev server's first compile instead of on the app. One generous,
 * condition-based wait here means every test timeout measures the app, not the build.
 *
 * <p>It signs in as a throwaway user so the lazily loaded signed-in pages are compiled too, then
 * deletes the user. Explicit waits only, like everything else.
 */
public class AppWarmUp implements ISuiteListener {

  private static final Duration COLD_START_TIMEOUT = Duration.ofMinutes(3);

  @Override
  public void onStart(ISuite suite) {
    Instant start = Instant.now();
    TestUser user = TestUser.create("warmup");
    try {
      WebDriver driver = DriverFactory.start();
      WebDriverWait wait = new WebDriverWait(driver, COLD_START_TIMEOUT);
      driver.get(Config.baseUrl() + "/");
      wait.until(ExpectedConditions.elementToBeClickable(By.cssSelector("form button[type='submit']")));
      driver.findElement(By.id("email")).sendKeys(user.email());
      driver.findElement(By.id("password")).sendKeys(user.password());
      driver.findElement(By.cssSelector("form button[type='submit']")).click();
      wait.until(ExpectedConditions.visibilityOfElementLocated(By.xpath("//h1[normalize-space(.)='Diary']")));
      System.out.printf(
          "[warm-up] app ready in %d s%n", Duration.between(start, Instant.now()).toSeconds());
    } finally {
      DriverFactory.quit();
      user.delete();
    }
  }
}
