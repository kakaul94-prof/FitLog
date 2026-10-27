package app.fitlog.e2e.pages;

import io.qameta.allure.Step;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;

/** The Progress tab (/progress): log a body weight, and the weigh-in history below it. */
public class ProgressPage extends BasePage {

  private final By heading = heading("Progress");
  // The visible label is not associated with its input (no htmlFor/id), so target the input
  // that follows it. This is the one locator in the suite that leans on DOM order.
  private final By weightInput =
      By.xpath("//label[normalize-space(.)='Log weight (lb)']/following-sibling::input");
  private final By addButton = buttonWithText("Add");

  public ProgressPage(WebDriver driver) {
    super(driver);
  }

  @Step("Open the Progress tab")
  public ProgressPage open() {
    open("/progress");
    return waitUntilLoaded();
  }

  public ProgressPage waitUntilLoaded() {
    visible(heading);
    return this;
  }

  /** Type a weight in pounds and tap Add. */
  @Step("Log weight {lb} lb")
  public void logWeight(String lb) {
    fill(weightInput, lb);
    click(addButton);
  }

  /** A history row's text, e.g. "172.4 lb". */
  private static By historyEntry(String lb) {
    return textExact(lb + " lb");
  }

  @Step("Expect {lb} lb in the history")
  public void waitForHistoryEntry(String lb) {
    visible(historyEntry(lb));
  }

  @Step("Expect {lb} lb gone from the history")
  public void waitForHistoryEntryGone(String lb) {
    waitUntilGone(historyEntry(lb));
  }

  public boolean hasHistoryEntry(String lb) {
    return isPresentNow(historyEntry(lb));
  }

  @Step("Delete the {lb} lb weigh-in")
  public void deleteWeighIn(String lb) {
    click(By.cssSelector("button[aria-label='Delete " + lb + " lb']"));
  }
}
