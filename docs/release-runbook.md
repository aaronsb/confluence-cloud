# Release Runbook

How to ship a new version of confluence-cloud-mcp.

## What Happens on Release

A single `git tag` push triggers two CI workflows:

| Workflow | File | What it does |
|----------|------|-------------|
| **Publish to npm** | `.github/workflows/npm-publish.yml` | Builds, publishes to npm with provenance |
| **Build .mcpb** | `.github/workflows/release-mcpb.yml` | Builds .mcpb bundle, attaches to GitHub Release |

Both trigger on `push: tags: ['v*']`. One `.mcpb` file is produced (pure TypeScript — no platform-specific builds needed).

The MCP Registry publish (`make publish-registry`) remains a manual step after CI confirms green.

## Release Flow

### 1. Ensure main is clean

```bash
git checkout main && git pull
make check          # lint + test + build must pass
```

### 2. Bump version

```bash
# Pick one:
make release-patch  # x.y.Z — bug fixes
make release-minor  # x.Y.0 — new features
make release-major  # X.0.0 — breaking changes
```

`make release-*` runs `check`, bumps `package.json`, syncs version to `server.json` + `mcpb/manifest.json`, commits, tags, and pushes.

If `make check` fails, fix it first. Don't skip the check.

### 3. Manual release (if make fails)

If `make release-*` fails partway through, complete manually:

```bash
npm version minor --no-git-tag-version   # or patch/major
make version-sync                         # sync to server.json + mcpb/manifest.json
git add package.json package-lock.json server.json mcpb/manifest.json
git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push && git push --tags
```

### 4. Verify npm CI

```bash
gh run list --limit 3   # should show npm-publish running
gh run watch <run-id>   # watch it
```

Check:
- npm publish: green, published to correct tag (`latest` vs `alpha`/`beta`/`rc`)
- .mcpb build: green, artifact attached to GitHub Release

### 5. Publish to MCP Registry

Once both CI workflows are green, run from the tagged commit:

```bash
git checkout vX.Y.Z     # ensure you're on the tagged commit
make publish-registry   # publishes to MCP Registry (manual step)
```

Note: `make publish-github` is superseded by the CI workflow. Use it only as a fallback if CI fails to create the GitHub Release.

### 6. Verify artifacts

```bash
# npm
npm view @aaronsb/confluence-cloud-mcp version

# GitHub Release
gh release view vX.Y.Z

# MCP Registry (no CLI verification — check https://registry.modelcontextprotocol.io)
mcp-publisher login github   # if needed
```

The GitHub Release should have one `.mcpb` file: `confluence-cloud-mcp.mcpb` (pure JS — no platform-specific builds needed).

## Pre-release Versions

For alpha/beta/rc releases:

```bash
npm version preminor --preid alpha --no-git-tag-version
# → x.y.0-alpha.0
make version-sync
# commit, tag, push as above
```

npm-publish.yml auto-detects the pre-release tag from the version string and publishes with `--tag alpha` (or beta/rc) instead of `--tag latest`.

## Retagging

If a tag was pushed before a fix was ready:

```bash
git tag -d vX.Y.Z                        # delete local tag
git push origin :refs/tags/vX.Y.Z        # delete remote tag
# fix the issue, commit, push
git tag -a vX.Y.Z -m "vX.Y.Z"           # retag on fixed commit
git push --tags                           # triggers CI again
```

## Version Files

The version lives in three places, kept in sync by `make version-sync`:

| File | Field | Purpose |
|------|-------|---------|
| `package.json` | `version` | Source of truth, npm |
| `server.json` | `version` | MCP server metadata |
| `mcpb/manifest.json` | `version` | .mcpb bundle metadata |

Never edit these manually — use `npm version` + `make version-sync`.
