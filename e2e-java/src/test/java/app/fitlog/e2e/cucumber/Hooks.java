package app.fitlog.e2e.cucumber;

import app.fitlog.e2e.driver.DriverFactory;
import app.fitlog.e2e.support.FailureEvidence;
import app.fitlog.e2e.support.TestUser;
import io.cucumber.java.After;
import io.cucumber.java.Before;
import io.cucumber.java.Scenario;

/** Per-scenario setup and teardown: the Cucumber twin of BaseUiTest's @BeforeMethod/@AfterMethod. */
public class Hooks {

  private final ScenarioContext context;

  public Hooks(ScenarioContext context) {
    this.context = context;
  }

  @Before
  public void startUserAndBrowser() {
    context.setUser(TestUser.create("bdd"));
    DriverFactory.start();
  }

  @After
  public void captureEvidenceAndTearDown(Scenario scenario) {
    try {
      if (scenario.isFailed() && DriverFactory.hasDriver()) {
        FailureEvidence.capture(context.driver(), scenario.getName());
      }
    } finally {
      DriverFactory.quit();
      TestUser user = context.user();
      if (user != null) user.delete();
    }
  }
}
