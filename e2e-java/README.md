# FitLog Java E2E: Selenium + TestNG + Cucumber + REST Assured

A small, deliberately readable Java test framework for FitLog's most important
flows: sign in, log a food, edit and delete it, watch the totals move, log a
weigh-in. It drives the real app in a real browser against the same disposable
local Supabase stack the Playwright and Python suites use, never a hosted project.

| Layer | Runner | What it covers | Count |
|---|---|---|---|
| UI journeys | TestNG + Selenium | Sign in (valid / wrong password / empty, one `@DataProvider`), Quick add saves an entry, meal and day totals update, edit servings, change meal, delete an entry (native confirm), log a weigh-in, delete a weigh-in | 8 methods, 10 cases |
| Scenarios | Cucumber (Gherkin) through the TestNG runner | Logging a food entry, deleting an entry (two scenarios), logging a weigh-in | 3 features, 4 scenarios |
| API | REST Assured | Create an entry and read it back field by field; a signed-out insert is refused with 401; another user can neither read nor delete your entry | 3 tests |

Every test is tagged `smoke` or `regression` (Cucumber: `@smoke` / `@regression`),
retries are off, and each test creates its own user and data, so the suite runs
in parallel and in any order. Reports are Allure, with a screenshot and the page
URL attached to every failed UI test.

## Run it

You need Docker (the local Supabase stack), Node 22 with `npm ci` done at the
repo root (the dev server and the Supabase CLI), and Java 17. Maven itself is
not needed: the Maven Wrapper downloads it on first use.

```bash
npm run db:start                 # the local Supabase stack, once
bash e2e-java/scripts/run.sh     # start the app on :5174, run everything, stop the app
```

The same, through the repo's test entry point: `make test-java` (or
`bash scripts/test-all.sh test-java`). Useful variations:

```bash
bash e2e-java/scripts/run.sh -Dgroups=smoke                   # TestNG groups
bash e2e-java/scripts/run.sh -Dcucumber.filter.tags=@smoke    # Cucumber tags
HEADLESS=true BROWSER=firefox bash e2e-java/scripts/run.sh    # or -Dheadless=true -Dbrowser=firefox
```

Report, after a run:

```bash
cd e2e-java && ./mvnw allure:serve        # builds target/site/allure-maven-plugin and opens it
```

From an IDE: `source e2e-java/scripts/start-app.sh` in a terminal first (it
exports the stack's URL and keys and starts the app), then run `testng.xml` or
any test class from the same environment. `scripts/stop-app.sh` stops the app.

### Settings

Everything is read in this order: `-D` system property, environment variable,
then `src/test/resources/config.properties`.

| Property | Environment variable | Default | Meaning |
|---|---|---|---|
| `base.url` | `FITLOG_BASE_URL` | `http://localhost:5174` | the app under test |
| `supabase.url` | `SUPABASE_URL` | `http://127.0.0.1:54321` | the local stack's API |
| `supabase.anon.key` | `SUPABASE_ANON_KEY` | none | the public key the app uses; from the stack |
| `supabase.service.role.key` | `SUPABASE_SERVICE_ROLE_KEY` | none | creates and deletes test users only |
| `browser` | `BROWSER` | `chrome` | `chrome` or `firefox` |
| `headless` | `HEADLESS` | `false` | CI sets `true` |
| `timeout.seconds` | `TIMEOUT_SECONDS` | `10` | every explicit wait |

No key is in the repo. `start-app.sh` reads them from the running stack
(`supabase status`, via the API suite's `local-env.sh`), and `Config` refuses any
app or Supabase URL whose host is not local.

## How it's structured

```
e2e-java/
├── pom.xml                     # dependencies, Surefire (parallel, retries off), Allure plugin
├── mvnw, mvnw.cmd, .mvn/       # Maven Wrapper: no Maven install needed
├── vite.e2e.config.ts          # the app's Vite config with live reload off, for test runs
├── scripts/
│   ├── start-app.sh            # exports the stack's URL + keys, starts Vite on :5174
│   ├── stop-app.sh
│   └── run.sh                  # start-app → ./mvnw test → stop-app
└── src/test/
    ├── java/app/fitlog/e2e/
    │   ├── config/Config.java          # settings + the local-only guard
    │   ├── driver/DriverFactory.java   # one WebDriver per thread (ThreadLocal), Chrome or Firefox
    │   ├── pages/                      # page objects: private By fields, public actions
    │   │   ├── BasePage.java           # explicit waits, fill(), the two text-locator helpers
    │   │   ├── LoginPage, DiaryPage, FoodPickerPage, EntryPage, ProgressPage, AppNav
    │   │   └── Meal.java
    │   ├── api/                        # REST Assured clients
    │   │   ├── SupabaseAuth.java       # admin create/delete (service role), password sign-in
    │   │   ├── FitLogApi.java          # data API as one user + eventually() polling
    │   │   └── Session.java
    │   ├── support/
    │   │   ├── AppWarmUp.java          # suite listener: load the app once before any test
    │   │   ├── TestUser.java           # a user that exists for one test
    │   │   ├── RunId.java              # run-unique names
    │   │   └── FailureEvidence.java    # screenshot + URL on failure
    │   ├── tests/                      # TestNG
    │   │   ├── BaseUiTest.java         # @BeforeMethod / @AfterMethod
    │   │   ├── LoginTest, DiaryTest, EntryTest, ProgressTest
    │   │   └── api/DiaryApiTest.java
    │   └── cucumber/
    │       ├── RunCucumberTest.java    # the TestNG Cucumber runner (parallel scenarios)
    │       ├── Hooks.java, ScenarioContext.java
    │       └── DiarySteps.java, ProgressSteps.java
    └── resources/
        ├── testng.xml                  # what runs, parallel="methods"
        ├── config.properties, allure.properties
        └── features/*.feature
```

## Why it's built this way

**Explicit waits only.** Every wait is a `WebDriverWait` on a condition
(`visibilityOfElementLocated`, `elementToBeClickable`, `textToBe`,
`alertIsPresent`), in `BasePage`. There is no implicit wait and no
`Thread.sleep`: an implicit wait silently adds itself to every lookup, including
the ones that should fail fast, and a sleep is either too long (slow suite) or
too short (flaky suite). A condition wait takes exactly as long as the app takes,
and when it fails the message says which condition did not hold.

**Page objects.** One class per screen, locators as private `By` fields,
behaviour as public methods named after what a user does (`quickAdd`,
`deleteWeighIn`). Tests read as journeys and never see a selector, so a changed
button moves one line in one file. `Meal` is an enum shared by the UI and API
layers so the meal key and label can never drift apart.

**Locators.** Attributes first, through CSS: ids (`#email`, `#qa-kcal`,
`#srv`), aria-labels (`Delete 172.4 lb`, `1650 calories remaining`), hrefs,
`button[type=submit]`. Selenium's CSS has no text selector, so the only XPath in
the suite lives in two `BasePage` helpers, `buttonWithText` and `textExact`,
which match an element by its whole visible text, the same contract an
accessible name gives a screen reader. No `data-testid` was added to the app.
The one locator that leans on DOM order is the weigh-in input, whose label is not
associated with it, and it is commented as such in `ProgressPage`.

**Thread-safe drivers.** `DriverFactory` keeps the browser in a `ThreadLocal`.
`testng.xml` runs methods in parallel and the Cucumber runner's DataProvider runs
scenarios in parallel, so each thread must own its browser, its user and its
data. For the same reason the test classes keep no mutable fields: TestNG runs
the methods of one class instance on several threads, so `BaseUiTest` exposes
`driver()` and `user()` accessors backed by ThreadLocals rather than fields.

**A user per test, data per run.** Each test creates its own user through the
Auth admin API with the service-role key (the only place that key is used),
signs in through the real form, and deletes the user in teardown, which cascades
to every row it created. That one call is the whole cleanup. Names also carry a
run id (`Oats-m2k9x1c-3`), so a rerun against the same database never sees a
previous run's rows. This is the same scheme as the repo's Python API suite.

**API for setup, UI for the journey, API for the proof.** Starting data goes in
through REST Assured (fast and exact); the behaviour under test goes through the
browser; and the assertion reads the database back, so a screen that looks right
while nothing was saved still fails. The food picker is optimistic, its "Added"
toast shows before the insert lands, so reads after a UI write go through
`FitLogApi.eventually`, a `FluentWait` on an API condition with the same timeout
as the page waits.

**DataProvider.** The three sign-in cases differ only in data, so they are one
test method and a `@DataProvider` of rows (valid, wrong password, empty). Each
row runs with its own user and browser and shows up as its own result.

**Cucumber through TestNG.** `RunCucumberTest` extends
`AbstractTestNGCucumberTests`, so one `./mvnw test` and one report cover the
features too. Step definitions call the same page objects as the TestNG tests;
nothing is duplicated. `ScenarioContext` (injected by picocontainer) carries the
scenario's user and the mapping from readable names in the feature ("Oats") to
run-unique names in the app, so the Gherkin stays readable and the data stays
isolated.

**REST Assured.** `FitLogApi.spec()` is one request specification (base URI,
anon key, bearer token, JSON, Allure filter) that both the test-data helpers and
the API tests build on, so an API test is a few readable lines of
`given().spec(...)...then().statusCode(...)`.

**No credentials in the report.** The data spec blacklists the `Authorization`
and `apikey` headers, and the Allure filter honours REST Assured's blacklist,
so they show as `[ BLACKLISTED ]`. The Auth calls (user create/delete,
sign-in), whose bodies carry passwords and tokens, are setup rather than
behaviour under test and are not attached at all. Allure also writes every
argument of an `@Step` method into its result files, and `@Param(mode =
MASKED)` only hides the value in the rendered page, not in the JSON that CI
uploads. So `LoginPage.signIn` builds its step by hand with `Allure.step(...)`
and records no parameters. A scan of a full run's results finds no password
and no token.

**Allure, not ExtentReports.** The repo already standardises on Allure: the
Python API suite and the AI evals write Allure results and CI builds them with
the same `allure-commandline`. Allure also has first-party adapters for TestNG,
Cucumber and REST Assured, so `@Step` annotations on the page objects become the
step list of each test and every API request and response is logged. On a
failure `FailureEvidence` attaches a screenshot and the page URL (and writes the
PNG to `target/screenshots`). ExtentReports would have been a second report
format for the same repository.

**Retries off, on purpose.** Surefire's `rerunFailingTestsCount` is 0 and the
TestNG suite has no retry analyzer. A test that needs a second try is a bug in
the test or the app, and the flake run below is how that is found.

**A still app under test.** The app is the Vite dev server, which has two
habits that make tests fail for reasons unrelated to the app, so the suite
neutralises both without touching the app:

- *Cold start.* On a fresh install (every CI run) Vite compiles and bundles
  the app's dependencies on the first page loads, which can take a minute.
  `AppWarmUp`, a TestNG suite listener, loads the app and signs in once
  before any test, with one generous condition-based wait. Every test's
  10-second waits then measure the app, not the dev server's first compile.
- *Live reload.* Vite reloads every open page when any `.html` file in the
  repo changes, and the suite writes HTML attachments into
  `target/allure-results` while it runs: a reload in the middle of a parallel
  test. `vite.e2e.config.ts` is the app's own config with HMR off and
  `e2e-java/` unwatched, and `start-app.sh` starts the server with it.

**Same stack, never production.** `Config` refuses any URL that is not local,
mirroring `e2e/support/env.ts` and the Python testkit. The app gets the local
stack's URL and key as `VITE_*` variables from `start-app.sh`, exactly as
`playwright.config.ts` does, so a developer's `.env` is never used.

## CI

`.github/workflows/ci.yml` has an `e2e-java` job: Java 17 with a Maven cache,
`npm ci`, `supabase start`, `start-app.sh`, then `./mvnw test` headless in the
runner's own Chrome. It uploads the Allure report, the JUnit XML and any failure
screenshots. It runs alongside the Playwright job and is not a `deploy-prod`
gate until it has a green history.

## Measured

Local machine: Windows 11, 8 logical cores, Docker Desktop running the Supabase
stack, headless Chrome, 4 test threads.

| | |
|---|---|
| Tests | 17 (10 TestNG cases, 4 scenarios, 3 API) |
| `./mvnw test` wall time, warm dev server | 98–136 s over 10 runs, median 104 s |
| Typical UI test | 7–15 s (user + browser start, sign-in through the form, journey, read-back) |
| API test | under 1 s |
| 10 runs in a row, retries off | 170 executions, 0 failures, 0 dev-server reloads |
| Cold dev server (fresh `npm ci`) | the warm-up waits about a minute once, then the same |
| First run ever | plus a few minutes: the wrapper downloads Maven and the dependencies |

In CI (GitHub's `ubuntu-latest`, headless Chrome on the runner), first run on
PR #32:

| | |
|---|---|
| `e2e-java` job, end to end | 3 min 15 s |
| Starting the local Supabase stack | 50 s |
| `./mvnw test` | 109 s: a 47 s warm-up of the cold dev server, then 69 s of tests |
| Next to the Playwright job (5 min 51 s) | runs in parallel, so it adds no time to the pipeline |

## Things worth knowing

- **Delete asks with `window.confirm`.** `EntryPage.delete()` waits for
  `alertIsPresent()` and accepts it; the page object owns that detail.
- **React controlled inputs.** `BasePage.fill()` selects all and deletes before
  typing rather than calling `clear()`, which can leave React's state behind.
- **The empty-field sign-in case** never reaches the app: the browser's
  `required` validation blocks the submit, so the test asserts on the field's
  validation message and on the absence of an app error.
- **Chrome prefs.** `DriverFactory` turns off the password manager and the leak
  detection dialog, which otherwise can cover the app right after sign-in.
- **Fixed bottom nav.** Selenium scrolls a target to the nearest viewport edge,
  which on FitLog can put it under the bottom navigation ("element click
  intercepted"). `BasePage.click()` scrolls the element to the viewport centre
  first.
- **Surefire 3.5.x on purpose.** Surefire 3.6.0 dropped its TestNG provider: it
  runs TestNG through the JUnit Platform, ignores `suiteXmlFiles` (so no
  parallelism and no thread counts from `testng.xml`) and only logs a
  deprecation warning. The pom pins 3.5.6 and says why.
- **Windows: "Unable to establish loopback connection".** On Windows the JDK
  backs its NIO `Selector` (which Selenium's HTTP client needs) with a
  Unix-domain socket file in `%TEMP%`, and on some machines that connect fails.
  The pom points `jdk.net.unixdomain.tmpdir` at `target/` for the test JVM, so
  the suite runs anyway; the same flag fixes Gradle builds that show the error.
