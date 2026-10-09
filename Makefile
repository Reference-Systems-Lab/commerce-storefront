# Developer entry points. CI runs the same targets.
.POSIX:
.PHONY: help lint test build backend backend-down

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' Makefile | sed 's/:.*## /\t/'

lint: ## Every static check CI runs: npm and Nuxt settings, ESLint, Prettier, vue-tsc and Knip
	sh ./scripts/lint.sh

test: ## Unit tests with coverage thresholds
	npm test

build: ## Build .output; the home page is prerendered, so no network is needed
	npm run build

backend: ## Run Postgres and the backend v0.1.0, seeded, on 127.0.0.1:18080 (for npm run dev)
	sh ./scripts/backend.sh up

backend-down: ## Stop the development backend and remove its data
	sh ./scripts/backend.sh down
