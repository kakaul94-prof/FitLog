package app.fitlog.e2e.config;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.time.Duration;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;

/**
 * Where the suite points and how it drives the browser.
 *
 * <p>Precedence for every setting: {@code -D} system property, then environment variable, then
 * {@code config.properties}. Keys are never in the properties file or in code: they come from
 * the running local Supabase stack ({@code scripts/start-app.sh} exports them), so nothing
 * secret is committed and a copied hosted-project key cannot be used by accident.
 *
 * <p>Safety rail: both URLs must point at a local host. The suite creates users and writes rows
 * freely, so it refuses to start against anything else (same rule as the Playwright and Python
 * suites).
 */
public final class Config {

  public enum Browser {
    CHROME,
    FIREFOX
  }

  private static final Properties FILE = loadProperties();
  private static final Set<String> LOCAL_HOSTS =
      Set.of("localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal");

  private Config() {}

  /** The app under test, e.g. {@code http://localhost:5174} (the Vite dev server). */
  public static String baseUrl() {
    return localOnly("FITLOG_BASE_URL", required("base.url", "FITLOG_BASE_URL"));
  }

  /** The local Supabase stack's API, e.g. {@code http://127.0.0.1:54321}. */
  public static String supabaseUrl() {
    return localOnly("SUPABASE_URL", required("supabase.url", "SUPABASE_URL"));
  }

  /** The public anon key: what the app itself sends with every request. */
  public static String anonKey() {
    return required("supabase.anon.key", "SUPABASE_ANON_KEY");
  }

  /** Service-role key: used only to create and delete test users, never in a request under test. */
  public static String serviceRoleKey() {
    return required("supabase.service.role.key", "SUPABASE_SERVICE_ROLE_KEY");
  }

  public static Browser browser() {
    return Browser.valueOf(get("browser", "BROWSER", "chrome").toUpperCase(Locale.ROOT));
  }

  public static boolean headless() {
    return Boolean.parseBoolean(get("headless", "HEADLESS", "false"));
  }

  /** The explicit-wait timeout used by every page object. */
  public static Duration timeout() {
    return Duration.ofSeconds(Long.parseLong(get("timeout.seconds", "TIMEOUT_SECONDS", "10")));
  }

  private static String get(String key, String env, String fallback) {
    String value = System.getProperty(key);
    if (isBlank(value)) value = System.getenv(env);
    if (isBlank(value)) value = FILE.getProperty(key);
    return isBlank(value) ? fallback : value.trim();
  }

  private static String required(String key, String env) {
    String value = get(key, env, null);
    if (value == null) {
      throw new IllegalStateException(
          "Missing "
              + env
              + " (or -D"
              + key
              + "). Start the local stack (npm run db:start), then: source e2e-java/scripts/start-app.sh");
    }
    return value;
  }

  private static String localOnly(String name, String url) {
    String host = URI.create(url).getHost();
    if (host == null || !LOCAL_HOSTS.contains(host)) {
      throw new IllegalStateException(
          name
              + " must point at the local test stack, got "
              + url
              + ". This suite creates users and rows; it never runs against a hosted project.");
    }
    return url.replaceAll("/+$", "");
  }

  private static Properties loadProperties() {
    Properties properties = new Properties();
    try (InputStream in = Config.class.getClassLoader().getResourceAsStream("config.properties")) {
      if (in != null) properties.load(in);
    } catch (IOException e) {
      throw new IllegalStateException("config.properties could not be read", e);
    }
    return properties;
  }

  private static boolean isBlank(String s) {
    return s == null || s.isBlank();
  }
}
