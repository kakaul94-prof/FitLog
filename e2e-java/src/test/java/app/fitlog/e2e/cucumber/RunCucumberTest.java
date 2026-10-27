package app.fitlog.e2e.cucumber;

import io.cucumber.testng.AbstractTestNGCucumberTests;
import io.cucumber.testng.CucumberOptions;
import org.testng.annotations.DataProvider;

/**
 * Runs the Gherkin features through TestNG, so one Maven command and one report cover the
 * TestNG tests and the scenarios alike.
 *
 * <p>Each scenario is one row of the inherited DataProvider; making it parallel runs scenarios
 * on separate threads, each with its own browser and user from {@link Hooks}. Filter with
 * {@code -Dcucumber.filter.tags=@smoke}.
 */
@CucumberOptions(
    features = "src/test/resources/features",
    glue = "app.fitlog.e2e.cucumber",
    plugin = {"pretty", "io.qameta.allure.cucumber7jvm.AllureCucumber7Jvm"})
public class RunCucumberTest extends AbstractTestNGCucumberTests {

  @Override
  @DataProvider(parallel = true)
  public Object[][] scenarios() {
    return super.scenarios();
  }
}
