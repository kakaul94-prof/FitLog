package app.fitlog.e2e.pages;

import io.qameta.allure.Step;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;

/** The bottom navigation every signed-in page shows: Diary / Exercise / Progress / More. */
public class AppNav extends BasePage {

  private final By diaryTab = tab("/");
  private final By progressTab = tab("/progress");

  public AppNav(WebDriver driver) {
    super(driver);
  }

  private static By tab(String href) {
    return By.cssSelector("nav a[href='" + href + "']");
  }

  @Step("Open the Diary tab")
  public DiaryPage diary() {
    click(diaryTab);
    return new DiaryPage(driver).waitUntilLoaded();
  }

  @Step("Open the Progress tab")
  public ProgressPage progress() {
    click(progressTab);
    return new ProgressPage(driver).waitUntilLoaded();
  }
}
