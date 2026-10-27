package app.fitlog.e2e.pages;

import app.fitlog.e2e.config.Config;
import java.util.Arrays;
import org.openqa.selenium.By;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.Keys;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

/**
 * Shared behaviour for every page object.
 *
 * <p>Waits are explicit and condition-based only: {@link WebDriverWait} with
 * {@link ExpectedConditions}. There is no implicit wait and no sleep anywhere in the suite, so a
 * test takes exactly as long as the app does and fails with the condition that was not met.
 *
 * <p>Locators live in the page objects as private {@code By} fields; tests never see them.
 * Attributes come first (id, aria-label, href, type) through CSS. Selenium's CSS has no text
 * selector, so the few text-based locators are built by the helpers at the bottom of this
 * class, which hold the suite's only XPath. Matching a button by its whole visible text is the
 * same contract an accessible name gives a user or a screen reader.
 */
public abstract class BasePage {

  protected final WebDriver driver;
  protected final WebDriverWait wait;

  protected BasePage(WebDriver driver) {
    this.driver = driver;
    this.wait = new WebDriverWait(driver, Config.timeout());
  }

  // ---- navigation ------------------------------------------------------------------------

  protected void open(String path) {
    driver.get(Config.baseUrl() + path);
  }

  public String currentUrl() {
    return driver.getCurrentUrl();
  }

  // ---- explicit waits --------------------------------------------------------------------

  protected WebElement visible(By by) {
    return wait.until(ExpectedConditions.visibilityOfElementLocated(by));
  }

  protected WebElement clickable(By by) {
    return wait.until(ExpectedConditions.elementToBeClickable(by));
  }

  protected void waitUntilGone(By by) {
    wait.until(ExpectedConditions.invisibilityOfElementLocated(by));
  }

  /**
   * Click once the element is clickable. The element is first scrolled to the middle of the
   * viewport: Selenium's own scroll aligns it with the nearest edge, where FitLog's fixed bottom
   * nav would receive the click instead ("element click intercepted").
   */
  protected void click(By by) {
    WebElement element = clickable(by);
    ((JavascriptExecutor) driver)
        .executeScript("arguments[0].scrollIntoView({block: 'center', inline: 'nearest'})", element);
    element.click();
  }

  /**
   * Replace an input's value. Select-all + delete rather than {@code clear()}: on a React
   * controlled input, {@code clear()} can leave React's own state behind, and the new text is
   * then appended to the old value.
   */
  protected void fill(By by, String text) {
    WebElement input = visible(by);
    input.sendKeys(Keys.chord(Keys.CONTROL, "a"), Keys.DELETE);
    if (!text.isEmpty()) input.sendKeys(text);
  }

  protected String textOf(By by) {
    return visible(by).getText().trim();
  }

  /** Whether the element is on screen right now, without waiting. For branching, not asserting. */
  protected boolean isPresentNow(By by) {
    return driver.findElements(by).stream().anyMatch(WebElement::isDisplayed);
  }

  /** Wait until any one of the candidates is visible, and return that locator. */
  protected By firstVisible(By... candidates) {
    return wait.until(
        d -> Arrays.stream(candidates).filter(this::isPresentNow).findFirst().orElse(null));
  }

  // ---- text locators (the suite's only XPath) --------------------------------------------

  /** A button whose whole visible text is exactly {@code text}, whitespace-normalised. */
  protected static By buttonWithText(String text) {
    return By.xpath("//button[normalize-space(.)=" + literal(text) + "]");
  }

  /** The innermost element whose whole text is exactly {@code text} (a toast, a title, a row). */
  protected static By textExact(String text) {
    String t = literal(text);
    return By.xpath("//*[normalize-space(.)=" + t + " and not(.//*[normalize-space(.)=" + t + "])]");
  }

  /** The page's h1. */
  protected static By heading(String text) {
    return By.xpath("//h1[normalize-space(.)=" + literal(text) + "]");
  }

  /** Quote a string for XPath, including strings that contain apostrophes. */
  static String literal(String s) {
    if (!s.contains("'")) return "'" + s + "'";
    if (!s.contains("\"")) return "\"" + s + "\"";
    return "concat('" + s.replace("'", "',\"'\",'") + "')";
  }
}
