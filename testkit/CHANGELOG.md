# Changelog

Notable changes to `fitlog-testkit`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); while the version is
0.x, a minor release may change the public API, and its entry says how to update.

## [Unreleased]

## [0.1.0] - 2026-10-13

The first release as a package of its own. The code itself is unchanged: it was
`api-tests/testkit/`, installed as part of the API suite with
`pip install -e ./api-tests`.

### Added

- Packaging: `pyproject.toml` (distribution `fitlog-testkit`, import name
  `testkit`), a src layout, and a `py.typed` marker so suites type-check
  against it. The version lives in `testkit.__version__`.
- A public API: the names in `testkit.__all__` import from the package itself,
  e.g. `from testkit import RestClient, UserFactory, create_row`. The contracts
  (`testkit.models`) and the Claude stub (`testkit.anthropic_stub`) stay
  module imports.
- The testkit's own test suite (`tests/`, 103 tests): the local-only guard,
  token forging, the leak scanner, every HTTP client against a fake transport,
  user clean-up order, the table registry and factories, the contracts, and the
  Claude stub run for real. Offline, about 10 seconds.
- A README with a five-minute guide to starting a new suite on the testkit.

### Changed

- Moved from `api-tests/testkit/` to `testkit/src/testkit/`. Module paths
  (`testkit.rest`, `testkit.anthropic_stub`, ...) are unchanged, so every
  existing import still works.

### Migrating from `pip install -e ./api-tests`

- In the suite's requirements, replace `-e ./api-tests` with `-e ./testkit`.
  A suite that includes `-r ../api-tests/requirements.txt` already gets it.
- Remove any mypy `mypy_path` that points at `../api-tests`: the editable
  install is visible to mypy now.
