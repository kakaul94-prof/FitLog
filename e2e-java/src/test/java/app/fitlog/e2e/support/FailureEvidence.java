package app.fitlog.e2e.support;

import io.qameta.allure.Allure;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.openqa.selenium.OutputType;
import org.openqa.selenium.TakesScreenshot;
import org.openqa.selenium.WebDriver;

/**
 * What a failed UI test leaves behind: a screenshot and the page URL, attached to the Allure
 * report and also written to target/screenshots so they survive without the report.
 */
public final class FailureEvidence {

  private static final Path DIR = Path.of("target", "screenshots");

  private FailureEvidence() {}

  public static void capture(WebDriver driver, String testName) {
    String url;
    try {
      url = driver.getCurrentUrl();
    } catch (RuntimeException e) {
      url = "(unavailable: " + e.getMessage() + ")";
    }
    Allure.addAttachment("Page URL", "text/plain", url);
    try {
      byte[] png = ((TakesScreenshot) driver).getScreenshotAs(OutputType.BYTES);
      Allure.addAttachment("Screenshot", "image/png", new ByteArrayInputStream(png), ".png");
      Files.createDirectories(DIR);
      Files.write(DIR.resolve(safeName(testName) + ".png"), png);
    } catch (IOException | RuntimeException e) {
      Allure.addAttachment("Screenshot failed", "text/plain", String.valueOf(e));
    }
  }

  private static String safeName(String name) {
    return name.replaceAll("[^A-Za-z0-9._-]", "_");
  }
}
