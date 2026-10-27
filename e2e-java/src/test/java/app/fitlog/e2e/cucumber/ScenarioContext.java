package app.fitlog.e2e.cucumber;

import app.fitlog.e2e.driver.DriverFactory;
import app.fitlog.e2e.support.RunId;
import app.fitlog.e2e.support.TestUser;
import java.util.HashMap;
import java.util.Map;
import org.openqa.selenium.WebDriver;

/**
 * State shared by the step classes of one scenario. Cucumber (via picocontainer) creates one
 * instance per scenario and injects it into every step class and the hooks, so steps pass data
 * to each other through it instead of through static fields.
 */
public class ScenarioContext {

  private TestUser user;
  private final Map<String, String> uniqueNames = new HashMap<>();

  public WebDriver driver() {
    return DriverFactory.current();
  }

  public TestUser user() {
    return user;
  }

  void setUser(TestUser user) {
    this.user = user;
  }

  /**
   * The run-unique name behind a readable one: the feature says "Oats", the app sees
   * "Oats-m2k9x1c-3", and every step of the scenario gets the same mapping.
   */
  public String unique(String readableName) {
    return uniqueNames.computeIfAbsent(readableName, RunId::unique);
  }
}
