---
status: Draft
date: 2026-03-18
deciders:
  - aaronsb
related:
  - ADR-100
  - ADR-302
  - ADR-500
---

# ADR-101: Operation-Dispatch Tool Surface

## Context

MCP servers must decide how to partition functionality into tools. Two extremes exist:
- **Many small tools** (one per API operation): clutters the tool list, forces the LLM to discover and compose dozens of tools
- **One mega-tool** (everything in one): schema becomes unwieldy, hard to validate inputs

Our reference implementations use a middle ground — a small number of **domain tools**, each accepting an `operation` parameter that dispatches to specific handlers:
- jira-cloud: 7 tools (manage_jira_issue, manage_jira_filter, etc.) with operation dispatch
- obsidian-mcp: 8 semantic tools (vault, edit, view, graph, workflow, system, dataview, bases)
- texflow-mcp: 6 tools (document, layout, edit, render, reference, queue)

Confluence Cloud's domain surface is: spaces, pages, content editing, search, media, navigation, and batch operations.

## Decision

Expose **7 MCP tools**, each with an `operation` parameter for dispatch:

| Tool | Operations | Scope |
|------|-----------|-------|
| `manage_confluence_page` | get, create, update, delete, move, copy, get_versions, pull_for_editing | Page CRUD and lifecycle |
| `edit_confluence_content` | patch_section, patch_block, append, replace, window_edit, list_blocks, sync, close | Structural content editing (ADR-301) |
| `manage_confluence_space` | list, get, create, update, get_permissions | Space management |
| `search_confluence` | cql, fulltext, by_label, by_contributor, recent | Search and discovery |
| `manage_confluence_media` | upload, download, list, delete, get_info | Attachments and images |
| `navigate_confluence` | children, ancestors, siblings, links, backlinks, tree | Page graph traversal (ADR-400) |
| `queue_confluence_operations` | (takes operations array) | Batch with `$N.field` references |

Each tool's schema uses conditional required fields based on the `operation` value, following the jira-cloud pattern.

Content editing is deliberately separated from page management because content editing is fundamentally different — it's session-based (ADR-301), structural (ADR-300), and validated per-operation (ADR-302). Page management is stateless CRUD.

## Consequences

### Positive

- 7 tools is discoverable — LLMs can reason about the full surface without context overflow
- Operation dispatch keeps related operations together (all page ops in one tool)
- Queue tool enables multi-step workflows in a single call
- Per-tool documentation exposed as MCP resources at `confluence://tools/{name}/documentation`

### Negative

- Tool schemas are larger than single-operation tools
- Some operations span tools (e.g., "create page with content" touches both manage and edit)
- LLMs occasionally pick the wrong tool when operations overlap in description

### Neutral

- Tool names follow the `verb_confluence_noun` pattern for consistency with jira-cloud
- `pull_for_editing` on manage_confluence_page creates the session; `edit_confluence_content` uses it — clear ownership boundary

## Alternatives Considered

- **Dynamic tool generation from API introspection** (atlassian-graph pattern): powerful but produces too many tools (~50+) and couples tool surface to API schema changes. Better suited for a generic Atlassian gateway, not a focused Confluence server.
- **Separate tools per block type** (wordpress-mcp pattern: list-blocks, edit-block, insert-block): too granular for MCP — results in 10+ tools just for content editing. The operation dispatch on `edit_confluence_content` achieves the same with one tool.
- **Three tools only** (pages, spaces, search): too coarse — editing and navigation deserve their own tools given their complexity.
