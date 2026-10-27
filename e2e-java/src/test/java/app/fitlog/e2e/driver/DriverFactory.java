package app.fitlog.e2e.driver;

import app.fitlog.e2e.config.Config;
import app.fitlog.e2e.config.Config.Browser;
import io.qameta.allure.Step;
import java.io.File;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.openqa.selenium.Capabilities;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeDriverService;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.firefox.FirefoxOptions;
import org.openqa.selenium.firefox.GeckoDriverService;
import org.openqa.selenium.remote.service.DriverFinder;
import org.openqa.selenium.remote.service.DriverService;

/**
 * One WebDriver per thread.
 *
 * <p>TestNG runs test methods on a pool of threads and Cucumber runs scenarios the same way. A
 * {@link ThreadLocal} gives each of them its own browser, so parallel tests never share a window,
 * a session or a URL. Nothing here is static state beyond the ThreadLocal and the driver-path
 * cache.
 *
 * <p>Drivers come from Selenium Manager (built into Selenium 4): it finds the installed browser
 * and downloads the matching driver binary, so there is no driver to install or version to pin.
 * It is asked once per browser per JVM; every later start reuses the path.
 *
 * <p>No implicit wait is ever set. Implicit and explicit waits add up in surprising ways; every
 * wait in this suite is an explicit {@code WebDriverWait} in {@code BasePage}.
 */
public final class DriverFactory {

  private static final ThreadLocal<WebDriver> DRIVER = new ThreadLocal<>();
  private static final Map<Browser, String> DRIVER_PATHS = new ConcurrentHashMap<>();

  /** A phone-sized window: FitLog is phone-first and renders in a centred max-w-md frame. */
  private static final int WIDTH = 480;
  private static final int HEIGHT = 1000;

  private DriverFactory() {}

  /** Start a browser for the current thread (each test or scenario calls this once). */
  @Step("Start the browser")
  public static WebDriver start() {
    if (DRIVER.get() != null) {
      throw new IllegalStateException("A driver is already running on this thread; quit() it first");
    }
    WebDriver driver = create(Config.browser(), Config.headless());
    DRIVER.set(driver);
    return driver;
  }

  /** The current thread's browser. */
  public static WebDriver current() {
    WebDriver driver = DRIVER.get();
    if (driver == null) {
      throw new IllegalStateException("No driver on this thread; call DriverFactory.start() first");
    }
    return driver;
  }

  public static boolean hasDriver() {
    return DRIVER.get() != null;
  }

  /** Close the current thread's browser and forget it. Safe to call twice. */
  @Step("Quit the browser")
  public static void quit() {
    WebDriver driver = DRIVER.get();
    if (driver == null) return;
    try {
      driver.quit();
    } finally {
      DRIVER.remove();
    }
  }

  private static WebDriver create(Browser browser, boolean headless) {
    return switch (browser) {
      case FIREFOX -> {
        FirefoxOptions options = new FirefoxOptions();
        if (headless) options.addArguments("-headless");
        options.addArguments("--width=" + WIDTH, "--height=" + HEIGHT);
        GeckoDriverService service =
            new GeckoDriverService.Builder()
                .usingDriverExecutable(driverExecutable(browser, options))
                .build();
        yield new FirefoxDriver(service, options);
      }
      case CHROME -> {
        ChromeOptions options = new ChromeOptions();
        if (headless) options.addArguments("--headless=new");
        options.addArguments(
            "--window-size=" + WIDTH + "," + HEIGHT,
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--no-first-run",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-search-engine-choice-screen");
        // No "save password?" bubble or password-leak dialog: either could cover the app
        // right after sign-in and steal the click a test is about to make.
        options.setExperimentalOption(
            "prefs",
            Map.of(
                "credentials_enable_service", false,
                "profile.password_manager_enabled", false,
                "profile.password_manager_leak_detection", false));
        ChromeDriverService service =
            new ChromeDriverService.Builder()
                .usingDriverExecutable(driverExecutable(browser, options))
                .build();
        yield new ChromeDriver(service, options);
      }
    };
  }

  /** The driver binary for a browser, resolved by Selenium Manager once per JVM. */
  private static File driverExecutable(Browser browser, Capabilities options) {
    return new File(
        DRIVER_PATHS.computeIfAbsent(
            browser,
            b -> {
              DriverService probe =
                  b == Browser.FIREFOX
                      ? GeckoDriverService.createDefaultService()
                      : ChromeDriverService.createDefaultService();
              return new DriverFinder(probe, options).getDriverPath();
            }));
  }
}
