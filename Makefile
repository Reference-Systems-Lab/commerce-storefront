# Developer entry points. CI runs the same targets.
.POSIX:
.PHONY: help lint test build

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' Makefile | sed 's/:.*## /\t/'

lint: ## Every static check CI runs: npm and Nuxt settings, ESLint, Prettier, vue-tsc and Knip
	sh ./scripts/lint.sh

test: ## Unit tests with coverage thresholds
	npm test

build: ## Build .output; the home page is prerendered, so no network is needed
	npm run build
