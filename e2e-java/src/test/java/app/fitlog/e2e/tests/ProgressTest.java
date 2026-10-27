package app.fitlog.e2e.tests;

import static org.assertj.core.api.Assertions.assertThat;

import app.fitlog.e2e.pages.AppNav;
import app.fitlog.e2e.pages.ProgressPage;
import io.qameta.allure.Feature;
import io.qameta.allure.Severity;
import io.qameta.allure.SeverityLevel;
import java.util.List;
import java.util.Map;
import org.testng.annotations.Test;

/** Body weight on the Progress tab. */
@Feature("Body weight")
public class ProgressTest extends BaseUiTest {

  @Test(groups = "smoke", description = "A logged weigh-in appears in the history and is saved")
  @Severity(SeverityLevel.CRITICAL)
  public void logWeighInShowsInHistory() {
    signIn();
    ProgressPage progress = new AppNav(driver()).progress();

    progress.logWeight("172.4");

    progress.waitForHistoryEntry("172.4");
    List<Map<String, Object>> saved =
        api().eventually("weigh-in reaches the database", a -> a.weighIns().isEmpty() ? null : a.weighIns());
    assertThat(saved).hasSize(1);
    assertThat(((Number) saved.get(0).get("value")).doubleValue()).isEqualTo(172.4);
    assertThat(saved.get(0)).containsEntry("measured_on", today().toString());
  }

  @Test(groups = "regression", description = "Deleting a weigh-in removes it from the history")
  @Severity(SeverityLevel.NORMAL)
  public void deleteWeighInRemovesIt() {
    api().addWeighIn(today(), "181.2");

    signIn();
    ProgressPage progress = new AppNav(driver()).progress();
    progress.waitForHistoryEntry("181.2");
    progress.deleteWeighIn("181.2");

    progress.waitForHistoryEntryGone("181.2");
    api().eventually("row deleted", a -> a.weighIns().isEmpty() ? Boolean.TRUE : null);
  }
}
