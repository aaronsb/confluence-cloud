.PHONY: build test lint fix clean check inspect mcpb help
.PHONY: version-sync release-patch release-minor release-major publish-all publish-check publish-registry publish-github

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
	@echo "Released v$(NEW_VERSION). CI publishes npm, the MCP Registry, and the GitHub Release with the .mcpb."

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

# CI publishes every channel on tag push (see .github/workflows/npm-publish.yml and
# release-mcpb.yml). These targets are the fallback for when CI cannot do it, and
# they run the same identity gate and idempotent registry publish as CI — a
# fallback runs precisely when something already went wrong, so a half-succeeded
# CI run (registry published, upload failed) must not die on the duplicate
# registry publish before reaching the upload.
publish-all: publish-check mcpb publish-registry publish-github  ## Manual fallback: registry + GitHub Release (CI does all of this on tag push)
	@echo ""
	@echo "v$(VERSION) published manually. Prefer letting CI do this on the next release."

publish-check:  ## Assert tag/package.json/server.json/mcpb manifest agree
	node scripts/check-publish-identity.cjs "v$(VERSION)"

publish-registry:  ## Publish to MCP Registry (idempotent)
	@echo "── MCP Registry ──"
	mcp-publisher login github
	bash scripts/mcp-registry-publish.sh

publish-github:  ## Create GitHub Release with MCPB bundle (idempotent)
	@echo "── GitHub Release ──"
	gh release view "v$(VERSION)" >/dev/null 2>&1 || gh release create "v$(VERSION)" --title "v$(VERSION)" --notes "$(NOTES)"
	gh release upload "v$(VERSION)" confluence-cloud-mcp.mcpb --clobber

# ── ADR ─────────────────────────────────────────────────────────────────

adr:            ## ADR management (usage: make adr CMD="new core title")
	docs/scripts/adr $(CMD)

help:           ## Show this help
	@grep -E '^[a-z_-]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
