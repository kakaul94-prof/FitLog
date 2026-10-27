package app.fitlog.e2e.cucumber;

import static org.assertj.core.api.Assertions.assertThat;

import app.fitlog.e2e.pages.AppNav;
import app.fitlog.e2e.pages.ProgressPage;
import io.cucumber.java.en.Then;
import io.cucumber.java.en.When;
import java.util.List;
import java.util.Map;

/** Steps for the weigh-in feature. */
public class ProgressSteps {

  private final ScenarioContext context;

  public ProgressSteps(ScenarioContext context) {
    this.context = context;
  }

  private ProgressPage progress() {
    return new ProgressPage(context.driver());
  }

  @When("I log a weight of {string} lb on the Progress tab")
  public void logWeight(String lb) {
    new AppNav(context.driver()).progress().logWeight(lb);
  }

  @Then("the weigh-in history shows {string} lb")
  public void historyShows(String lb) {
    progress().waitForHistoryEntry(lb);
  }

  @Then("a weigh-in of {string} lb is saved")
  public void weighInSaved(String lb) {
    List<Map<String, Object>> saved =
        context
            .user()
            .api()
            .eventually("weigh-in saved", a -> a.weighIns().isEmpty() ? null : a.weighIns());
    assertThat(saved).hasSize(1);
    assertThat(((Number) saved.get(0).get("value")).doubleValue()).isEqualTo(Double.parseDouble(lb));
  }
}
