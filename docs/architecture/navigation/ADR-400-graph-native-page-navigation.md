---
status: Draft
date: 2026-03-18
deciders:
  - aaronsb
related:
  - ADR-100
  - ADR-200
---

# ADR-400: Graph-Native Page Navigation

## Context

Confluence's content model is fundamentally a graph:
- Pages have parent-child relationships (tree hierarchy within a space)
- Pages link to other pages (cross-space, inline links in content)
- Pages have labels (shared tag namespace across spaces)
- Pages reference Jira issues and other Atlassian products
- Users watch, edit, and comment on pages (user-content relationships)

REST v2 exposes hierarchy as flat endpoints (`GET /pages/{id}/children`, `GET /pages/{id}/ancestors`) requiring multiple round-trips to build a tree view. The GraphQL gateway can traverse these relationships in a single query.

Our obsidian-mcp project demonstrates rich graph navigation patterns:
- BFS traversal with configurable depth and max nodes
- Backlink discovery (who references this page?)
- Forward link extraction (what does this page reference?)
- Tag-based connections (notes sharing tags)
- Path finding between two nodes
- Stats tracking (traversal time, node/edge counts)

## Decision

Implement a **navigation layer** exposed through the `navigate_confluence` tool:

| Operation | Purpose | Preferred Transport |
|-----------|---------|-----------|
| `children` | Direct children, with optional depth | REST (shallow) or GraphQL (deep) |
| `ancestors` | Path from page to space root | REST v2 |
| `siblings` | Pages at the same level under the same parent | REST (parent → children, filter) |
| `tree` | Full subtree with configurable depth/maxNodes | GraphQL (avoids N+1) |
| `links` | Pages this page links to (forward links from ADF body) | Content Model (parse body) |
| `backlinks` | Pages that link to this page | CQL (`link = "pageId"`) |
| `related` | Pages sharing labels with this page | CQL (`label in (...)`) |

**Progressive disclosure in responses**:
- Default: page ID, title, status, space key (minimal tokens)
- `expand: ['excerpt']`: adds page excerpt
- `expand: ['labels']`: adds label list
- `expand: ['metadata']`: adds dates, author, version

**Tree rendering** (for `tree` and `children` with depth):
```markdown
📄 Engineering (root)
├── 📄 API Design
│   ├── 📄 REST Conventions
│   └── 📄 Error Handling
├── 📄 Architecture
│   ├── 📄 ADR Index
│   └── 📄 System Diagram
└── 📄 Onboarding
    └── 📄 Setup Guide

6 pages, depth 2, traversal: 45ms
```

**Backlink and forward link responses include context** — not just "page X links here" but where in the page the link appears (heading context), following obsidian-mcp's pattern. This enables impact analysis: "if I rename this page, these 4 pages reference it in their 'Dependencies' section."

**Transport routing**: Shallow queries (children, ancestors, siblings) use REST because they're single requests. Deep queries (tree, complex relationship traversal) route to GraphQL per ADR-200.

## Consequences

### Positive

- LLMs understand page structure before editing — critical for move/restructure operations
- Backlink discovery enables impact analysis before changes
- Tree views are token-efficient (ASCII art vs. JSON arrays)
- GraphQL handles deep hierarchy in a single request
- Label-based navigation enables semantic discovery beyond keyword search

### Negative

- Forward link extraction requires parsing ADF content bodies — expensive for large pages
- Backlink queries via CQL may be slow on large instances (thousands of pages)
- Tree rendering must handle large subtrees gracefully (depth/maxNodes limits essential)
- GraphQL hierarchy queries are still maturing

### Neutral

- Navigation operations are read-only — no editing session required
- Results include semantic next-step hints per ADR-500
- The ASCII tree format is universally understood by LLMs and humans alike

## Alternatives Considered

- **REST-only navigation**: works for shallow queries but requires N+1 requests for tree views. A 3-level hierarchy with 5 children per level = 31 API calls vs. 1 GraphQL query.
- **No navigation tool** (rely on search only): search finds pages but doesn't show structure. "What are the child pages of Engineering?" is a navigation question, not a search.
- **Full graph database** (Neo4j-style cache): over-engineered. Confluence's hierarchy is a tree with cross-links, not an arbitrary graph. The navigation layer handles this without external infrastructure.
