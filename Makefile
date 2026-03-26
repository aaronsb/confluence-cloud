.PHONY: build test lint fix clean check inspect mcpb help
.PHONY: version-sync release-patch release-minor release-major publish-all

VERSION = $(shell node -p 'require("./package.json").version')

build:          ## Build TypeScript
	npm run build

test:           ## Run tests
	npx vitest run

test-watch:     ## Run tests in watch mode
	npx vitest

lint:           ## Run linter
	npm run lint

fix:            ## Run linter with auto-fix
	npm run lint:fix

check: lint test build  ## Lint, test, and build (CI gate)

clean:          ## Remove build output
	rm -rf build

inspect:        ## Launch MCP Inspector
	npm run inspector

# ── Version & Release ───────────────────────────────────────────────────

version-sync:   ## Sync version from package.json to server.json and mcpb/manifest.json
	@echo "Syncing version $(VERSION) to server.json and mcpb/manifest.json"
	node scripts/version-sync.cjs

release-patch: check  ## Bump patch, sync, commit, tag, push
	@echo "Current version: $(VERSION)"
	npm version patch --no-git-tag-version
	$(MAKE) version-sync
	$(MAKE) _release-commit

release-minor: check  ## Bump minor, sync, commit, tag, push
	@echo "Current version: $(VERSION)"
	npm version minor --no-git-tag-version
	$(MAKE) version-sync
	$(MAKE) _release-commit

release-major: check  ## Bump major, sync, commit, tag, push
	@echo "Current version: $(VERSION)"
	npm version major --no-git-tag-version
	$(MAKE) version-sync
	$(MAKE) _release-commit

_release-commit:
	$(eval NEW_VERSION := $(shell node -p 'require("./package.json").version'))
	git add package.json package-lock.json server.json mcpb/manifest.json
	git commit -m "chore: release v$(NEW_VERSION)"
	git tag -a "v$(NEW_VERSION)" -m "v$(NEW_VERSION)"
	git push && git push --tags
	@echo ""
	@echo "Released v$(NEW_VERSION). Run 'make publish-all' to publish."

# ── MCPB Bundle ─────────────────────────────────────────────────────────

mcpb: build     ## Build .mcpb desktop extension bundle
	rm -rf mcpb/server mcpb/package-lock.json
	mkdir -p mcpb/server
	cp -r build/* mcpb/server/
	cp package.json mcpb/server/package.json
	cd mcpb/server && npm install --production --ignore-scripts --silent
	rm -f mcpb/server/package-lock.json
	mcpb pack mcpb confluence-cloud-mcp.mcpb
	@echo ""
	@echo "Built: confluence-cloud-mcp.mcpb ($$(du -h confluence-cloud-mcp.mcpb | cut -f1))"

# ── Publishing ──────────────────────────────────────────────────────────

NOTES ?= Release v$(VERSION)

publish-all: mcpb publish-registry publish-github  ## Publish to all channels (npm is CI-only)
	@echo ""
	@echo "v$(VERSION) published to all channels."

publish-registry:  ## Publish to MCP Registry
	@echo "── MCP Registry ──"
	mcp-publisher login github
	mcp-publisher publish server.json

publish-github:  ## Create GitHub Release with MCPB bundle
	@echo "── GitHub Release ──"
	gh release create "v$(VERSION)" --title "v$(VERSION)" --notes "$(NOTES)" confluence-cloud-mcp.mcpb

# ── ADR ─────────────────────────────────────────────────────────────────

adr:            ## ADR management (usage: make adr CMD="new core title")
	docs/scripts/adr $(CMD)

help:           ## Show this help
	@grep -E '^[a-z_-]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
