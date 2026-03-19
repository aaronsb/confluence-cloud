.DEFAULT_GOAL := help
.PHONY: help build test lint fix clean check inspect install adr

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm ci

build: ## Build TypeScript
	npm run build

test: ## Run tests
	npx vitest run

lint: ## Run linter
	npm run lint

fix: ## Auto-fix lint errors
	npm run lint:fix

clean: ## Remove build artifacts
	rm -rf build/ coverage/

check: lint test build ## Run all quality gates

inspect: build ## Launch MCP Inspector
	npx @modelcontextprotocol/inspector build/index.js

adr: ## ADR management (usage: make adr CMD="new core title")
	docs/scripts/adr $(CMD)
