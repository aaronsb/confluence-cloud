---
status: Draft
date: 2026-03-19
deciders:
  - aaronsb
related:
  - ADR-101
  - ADR-200
  - ADR-500
---

# ADR-501: Page Metadata — Labels and Content Properties

## Context

The server can read and write page *content* (body, title, status) but has no tool-level access to page *metadata*: labels and content properties. Both are first-class Confluence v2 REST resources and are commonly used by teams to categorize, filter, and drive automation.

**Labels** — Tags that classify pages. The client already implements `getLabels`, `addLabel`, `removeLabel` (v2 endpoint `/pages/{id}/labels`), but these are not exposed through any tool schema.

**Content properties** — Key-value metadata attached to a page (v2 endpoint `/pages/{id}/properties`). Used for storing structured metadata (e.g., review status, custom fields, macro configuration state). Unlike labels, content properties have no client implementation yet.

**The discovery problem** — A fully hardcoded metadata system won't grow as Confluence matures. Atlassian regularly adds new metadata surfaces (e.g., content status, reactions, inline tasks). Rather than enumerating every possible metadata type at build time, the server should support runtime discovery of what metadata is available for a given page or space.

The atlassian-graph MCP server demonstrates this pattern well: it uses GraphQL introspection to discover available fields at runtime, then dynamically generates tool surfaces. While we don't need to go that far (our tool surface is operation-dispatch, not introspection-generated), we should design the metadata layer so:

1. Known metadata types (labels, properties) have first-class operations for convenience
2. GraphQL introspection can discover additional metadata fields on Confluence entities
3. The content property system itself is schema-flexible (arbitrary JSON values)

## Decision

### Layer 1: First-class metadata operations

Expose labels and content properties through the existing `manage_confluence_page` tool, consistent with ADR-101.

**Labels operations:**

| Operation | Required params | Description |
|-----------|----------------|-------------|
| `get_labels` | `pageId` | List all labels on a page |
| `add_labels` | `pageId`, `labels` (string[]) | Add one or more labels (idempotent) |
| `remove_label` | `pageId`, `label` (string) | Remove a single label |

Labels are added in bulk (array) since LLMs commonly want to tag a page with multiple labels at once. Removal is singular since it requires explicit intent per label.

**Content properties operations:**

| Operation | Required params | Description |
|-----------|----------------|-------------|
| `get_properties` | `pageId` | List all content properties |
| `get_property` | `pageId`, `propertyKey` | Get a single property by key |
| `set_property` | `pageId`, `propertyKey`, `propertyValue` (object) | Create or update (upsert) |
| `delete_property` | `pageId`, `propertyKey` | Delete a property |

Content properties use upsert semantics: `set_property` creates the property if it doesn't exist, or updates it (with version increment) if it does. This avoids forcing the LLM to check existence before writing.

### Layer 2: Metadata discovery via GraphQL

Add a `discover_metadata` operation to `navigate_confluence` that uses GraphQL introspection to report what metadata fields are available on Confluence pages in the current instance.

| Operation | Required params | Description |
|-----------|----------------|-------------|
| `discover_metadata` | `pageId` (optional) | Discover available metadata types and fields |

When called without a `pageId`, it introspects the GraphQL schema for Confluence page types and reports available metadata categories (labels, properties, status, reactions, etc.). When called with a `pageId`, it additionally fetches the actual metadata present on that page.

This uses the same `__schema` introspection query pattern as the atlassian-graph MCP server:
```graphql
query IntrospectConfluencePage {
  __type(name: "ConfluencePage") {
    fields {
      name
      description
      type { name kind ofType { name kind } }
    }
  }
}
```

The discovery response categorizes fields into:
- **Built-in metadata**: labels, content properties, status, version
- **Relationship metadata**: links, backlinks, ancestors, children (already in navigate tool)
- **Extended metadata**: any fields discovered via introspection not yet covered by first-class operations

This allows the LLM to understand what's available without us hardcoding every possible metadata type.

### Layer 3: Schema-flexible property values

Content property values are stored as arbitrary JSON objects, not typed schemas. The server validates only structural requirements (key is non-empty string, value is valid JSON object) and leaves semantic validation to the caller. This ensures the property system works with any Confluence app or integration that stores custom metadata.

### Client additions

Add to `ConfluenceClient` interface:
```typescript
// Content Properties
getProperties(pageId: string): Promise<ContentProperty[]>;
getProperty(pageId: string, key: string): Promise<ContentProperty>;
setProperty(pageId: string, key: string, value: object): Promise<ContentProperty>;
deleteProperty(pageId: string, key: string): Promise<void>;
```

Using v2 endpoints:
- `GET /pages/{id}/properties` — list all
- `GET /pages/{id}/properties/{key}` — get one
- `POST /pages/{id}/properties` — create (body: `{key, value}`)
- `PUT /pages/{id}/properties/{key}` — update (body: `{key, value, version: {number}}`)
- `DELETE /pages/{id}/properties/{key}` — delete

### Rendering

Labels render inline with page metadata: `Labels: architecture, api-design, reviewed`

Content properties render as a key-value table:
```
| Key | Value |
|-----|-------|
| review-status | {"state": "approved", "reviewer": "alice"} |
```

Discovery results render as a categorized list of available metadata fields with their types.

Next-step hints after label operations suggest `search_confluence` with `by_label`. After property operations, suggest getting the page or setting additional properties. After discovery, suggest using first-class operations for the discovered types.

## Consequences

### Positive

- Labels become searchable and manageable without leaving the MCP tool surface
- Content properties enable structured metadata workflows (review tracking, custom fields)
- Discovery layer means the server can surface new Confluence metadata types without code changes
- Upsert semantics for properties simplify LLM interaction (no version tracking needed for writes)
- Follows the atlassian-graph pattern of runtime discovery, adapted to operation-dispatch

### Negative

- Adds 7 new operations across two tools, increasing surface area
- GraphQL introspection adds startup or first-use latency (~1 query)
- Discovery results may include fields the server doesn't have first-class support for, requiring the LLM to understand the gap

### Neutral

- Labels use existing client implementation; only tool schema and handler changes needed
- Content properties require new client methods and a `ContentProperty` type
- Discovery is optional — all first-class operations work without it
- Both integrate with the existing rendering facade (ADR-500) and next-step hints

## Alternatives Considered

- **Fully introspection-driven tool surface (like atlassian-graph)**: Rejected — too much complexity for the convergent tool model. Discovery informs the LLM; first-class operations do the work.
- **Separate `manage_confluence_labels` tool**: Rejected — labels are page metadata, not a distinct entity. ADR-101 favors fewer tools with more operations.
- **Hardcode all metadata types**: Rejected — Confluence's metadata surface grows over time. A discovery mechanism future-proofs without requiring server updates for each new type.
- **Content properties via v1 API**: Rejected — v2 REST has clean property endpoints; v1 would add inconsistency.
