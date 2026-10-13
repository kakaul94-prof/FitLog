# Every test layer from one place. Each target delegates to scripts/test-all.sh,
# which also runs on its own where make is not installed (Git Bash on Windows):
#   bash scripts/test-all.sh test-api
#
# First time: npm ci, then create the API suite's environment:
#   python3 -m venv api-tests/.venv && api-tests/.venv/bin/pip install -r api-tests/requirements.txt
#   python3 -m venv ai-evals/.venv && ai-evals/.venv/bin/pip install -r ai-evals/requirements.txt

SHELL := bash
RUN := bash scripts/test-all.sh

.PHONY: help stack-up test-unit test-api test-ai eval-ai-live test-e2e test-security test report stack-down

help: ## List the targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{ printf "  make %-14s ", $$1; print $$2 }'

stack-up: ## Start the local Supabase stack (Docker)
	@$(RUN) stack-up

test-unit: ## Vitest unit tests
	@$(RUN) test-unit

test-api: ## API, database and security tests (pytest + pytest-bdd), JUnit + Allure output
	@$(RUN) test-api

test-ai: ## AI trainer evals, tier 1: Claude replaced by a scripted stub (no key, no cost)
	@$(RUN) test-ai

eval-ai-live: ## AI trainer evals, tier 2: real Claude, capped (~$0.80); ARGS="--only <id>" to narrow
	@$(RUN) eval-ai-live $(ARGS)

test-e2e: ## Playwright end-to-end tests, in their container
	@$(RUN) test-e2e

test-security: ## Security scans: gitleaks, npm audit, pip-audit, OWASP ZAP (report only)
	@$(RUN) test-security

test: ## Every layer, bottom of the pyramid first; stops at the first failure
	@$(RUN) test

report: ## Build the Allure report from the last API and AI-eval runs and open it
	@$(RUN) report

stack-down: ## Stop the local stack
	@$(RUN) stack-down
