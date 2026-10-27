# Every test layer from one place. Each target delegates to scripts/test-all.sh,
# which also runs on its own where make is not installed (Git Bash on Windows):
#   bash scripts/test-all.sh test-api
#
# First time: npm ci, then create the API suite's environment:
#   python3 -m venv api-tests/.venv && api-tests/.venv/bin/pip install -r api-tests/requirements.txt
#   python3 -m venv ai-evals/.venv && ai-evals/.venv/bin/pip install -r ai-evals/requirements.txt

SHELL := bash
RUN := bash scripts/test-all.sh

.PHONY: help stack-up test-unit test-contracts test-api test-ai eval-ai-live canary-prod test-e2e test-java test-security test report stack-down \
	perf-smoke perf-load perf-stress perf-soak perf-clean

help: ## List the targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{ printf "  make %-14s ", $$1; print $$2 }'

stack-up: ## Start the local Supabase stack (Docker)
	@$(RUN) stack-up

test-unit: ## Vitest unit tests
	@$(RUN) test-unit

test-contracts: ## Contract tests: the frontend's recorded API calls vs the Pages Functions (in-process) and the local Supabase stack
	@$(RUN) test-contracts

test-api: ## API, database and security tests (pytest + pytest-bdd), JUnit + Allure output
	@$(RUN) test-api

test-ai: ## AI trainer evals, tier 1: Claude replaced by a scripted stub (no key, no cost)
	@$(RUN) test-ai

eval-ai-live: ## AI trainer evals, tier 2: real Claude, capped (~$0.80); ARGS="--only <id>" to narrow
	@$(RUN) eval-ai-live $(ARGS)

canary-prod: ## The production AI canary once, by hand (needs ai-evals/.env.canary, ~$0.05); ARGS="--drill quality"
	@$(RUN) canary-prod $(ARGS)

test-e2e: ## Playwright end-to-end tests, in their container
	@$(RUN) test-e2e

test-java: ## Java E2E (Selenium + TestNG + Cucumber + REST Assured) against the local stack; ARGS="-Dgroups=smoke"
	@$(RUN) test-java $(ARGS)

test-security: ## Security scans: gitleaks, npm audit, pip-audit, OWASP ZAP (report only)
	@$(RUN) test-security

test: ## Every layer, bottom of the pyramid first; stops at the first failure
	@$(RUN) test

report: ## Build the Allure report from the last API and AI-eval runs and open it
	@$(RUN) report

perf-smoke: ## k6 smoke: 2 virtual users for a minute, zero errors allowed (the PR gate)
	@$(RUN) perf-smoke

perf-load: ## k6 load: the realistic journey mix at expected load, ~7 min, budgets enforced
	@$(RUN) perf-load

perf-stress: ## k6 stress (30→300 users) then spike (10→250 in 10 s), ~13 min, report-only
	@$(RUN) perf-stress

perf-soak: ## k6 soak: expected load held for SOAK_DURATION (default 60m) + drift check
	@$(RUN) perf-soak

perf-clean: ## Delete any @perf.test users a stopped perf run left behind
	@$(RUN) perf-clean

stack-down: ## Stop the local stack
	@$(RUN) stack-down
