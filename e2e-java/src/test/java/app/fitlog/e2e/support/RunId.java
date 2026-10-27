package app.fitlog.e2e.support;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Run-unique names. Every user, food and weigh-in a test creates carries this JVM's run id plus
 * a counter, so parallel tests never see each other's rows and the suite can be rerun against
 * the same database without a reset.
 */
public final class RunId {

  /** Unique per JVM start, e.g. "m2k9x1c". */
  public static final String VALUE = Long.toString(System.currentTimeMillis(), 36);

  private static final AtomicInteger COUNTER = new AtomicInteger();
  private static final SecureRandom RANDOM = new SecureRandom();

  private RunId() {}

  /** "{prefix}-{runId}-{n}", unique within this run. */
  public static String unique(String prefix) {
    return prefix + "-" + VALUE + "-" + COUNTER.incrementAndGet();
  }

  /** A throwaway password for a user that exists only during one test. */
  public static String password() {
    byte[] bytes = new byte[12];
    RANDOM.nextBytes(bytes);
    return "Pw-" + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }
}
