package app.fitlog.e2e.pages;

import io.qameta.allure.Allure;
import io.qameta.allure.Step;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;

/** The signed-out landing view: the email + password sign-in form. */
public class LoginPage extends BasePage {

  private final By emailInput = By.id("email");
  private final By passwordInput = By.id("password");
  private final By signInButton = By.cssSelector("form button[type='submit']");
  // The form's inline error paragraph (it has no role or id of its own).
  private final By errorMessage = By.cssSelector("form p.text-destructive");

  public LoginPage(WebDriver driver) {
    super(driver);
  }

  @Step("Open the sign-in page")
  public LoginPage open() {
    open("/");
    visible(signInButton);
    return this;
  }

  /**
   * Sign in through the form. This is a manual Allure step rather than {@code @Step}: Allure
   * writes every argument of an {@code @Step} method into its result files (MASKED only hides it
   * in the rendered page), and the password must not reach the report at all.
   */
  public void signIn(String email, String password) {
    Allure.step(
        "Sign in as " + email,
        () -> {
          fill(emailInput, email);
          fill(passwordInput, password);
          click(signInButton);
        });
  }

  /** The sign-in error shown under the form, once it appears. */
  public String errorMessage() {
    return textOf(errorMessage);
  }

  public boolean hasError() {
    return isPresentNow(errorMessage);
  }

  public boolean isShown() {
    return isPresentNow(signInButton);
  }

  /** The browser's own validation message on the email field ("Please fill out this field."). */
  public String emailValidationMessage() {
    return visible(emailInput).getDomProperty("validationMessage");
  }
}
