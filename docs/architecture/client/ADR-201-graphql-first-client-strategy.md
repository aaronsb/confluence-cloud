---
status: Draft
date: 2026-03-26
deciders:
  - aaronsb
related:
  - ADR-200
---

# ADR-201: GraphQL-First Client Strategy

## Context

ADR-200 established a hybrid REST/GraphQL architecture with the heuristic: REST for single-entity CRUD, GraphQL for relationship traversal. In practice, building page lifecycle operations (archive, unarchive, move) revealed that the balance has shifted further toward GraphQL than anticipated.

Key findings during implementation:

| Operation | REST Result | GraphQL Result |
|-----------|-------------|----------------|
| Archive page | v2 PUT rejects `status: 'archived'` | `bulkArchivePages` mutation works |
| Unarchive page | v1 PUT returns 403 on archived pages | `bulkUnarchivePages` mutation works |
| Move page | v2 PUT works (bumps version unnecessarily) | `movePageAppend` works cleanly |
| Copy page | v1 POST works | No GraphQL equivalent yet |

The Confluence UI itself uses GraphQL exclusively for these operations, routing through `/cgraphql` (the Confluence-specific GraphQL gateway). This is distinct from the Atlassian Gateway (`api.atlassian.com/graphql`) used for cross-product queries. Atlassian has announced RFC-19 for REST v1 deprecation, confirming the direction.

We now have three transport layers:

| Transport | Base URL | Used For |
|-----------|----------|----------|
| REST v2 | `/wiki/api/v2` | Page CRUD, spaces, attachments, labels, properties |
| REST v1 | `/wiki/rest/api` | CQL search, copy page, attachment upload |
| Confluence GraphQL | `/cgraphql` | Page lifecycle (move, archive, unarchive) |

The ad-hoc addition of GraphQL calls without a formal transport method led to code duplication and missing retry/rate-limit protection, which was corrected by extracting `requestCGraphQL`.

## Decision

Adopt **GraphQL-first** as the client strategy: prefer the Confluence GraphQL gateway (`/cgraphql`) for all operations where a mutation or query exists, falling back to REST only where GraphQL coverage gaps remain.

### Transport hierarchy

1. **Confluence GraphQL** (`requestCGraphQL`) — preferred for mutations and queries where available
2. **REST v2** (`request`) — for operations not yet in GraphQL, or where REST v2 is richer (e.g., body format negotiation)
3. **REST v1** (`requestV1`) — legacy fallback for endpoints with no v2 or GraphQL equivalent

### `requestCGraphQL` contract

```typescript
private async requestCGraphQL<T>(
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T>
```

- Routes through `fetchWithRetry` for 429/5xx protection
- Sends the batched array format that `/cgraphql` expects (`[{ operationName, query, variables }]`)
- Extracts `data` from the response, throws on `errors`
- Operation name appears in the query string (`?q=OperationName`) for observability

### Migration path

As Atlassian exposes more operations through `/cgraphql`, migrate them from REST:

| Priority | Operation | Current | Target |
|----------|-----------|---------|--------|
| Done | move, archive, unarchive | GraphQL | GraphQL |
| Next | search (if CQL wrapper appears) | REST v1 | GraphQL |
| Next | copy (when mutation lands) | REST v1 | GraphQL |
| Future | labels, properties | REST v2 | GraphQL (if available) |
| Keep | attachment upload/download | REST v1 | REST (binary payloads) |

Discovery approach: periodically introspect the `/cgraphql` schema for new mutations matching our operations. The schema supports `__type(name: "Mutation") { fields { name } }` introspection (though rate-limited to prevent abuse).

### Schema discovery constraints

The `/cgraphql` endpoint:
- Requires a known `operationName` for named operations, but allows anonymous queries
- Rate-limits introspection ("BadFaithIntrospection" error on multiple `__type` queries per request)
- Uses Confluence-internal types (`Long` for page IDs, `[Boolean!]!` for `includeChildren`)
- Returns responses in a batched array format, not standard GraphQL

These are implementation details, not blockers. The schema is stable enough for production use (the Confluence UI depends on it).

## Consequences

### Positive

- Operations work where REST fails (archive/unarchive are GraphQL-only in practice)
- Move operations are cleaner (no unnecessary version bumps)
- Forward-compatible with Atlassian's deprecation of REST v1
- Single retry/auth/error pattern across all three transports
- Schema introspection enables discovery of new GraphQL operations

### Negative

- `/cgraphql` is not a formally documented public API — it's the UI's backend
- Schema types can be surprising (`[Boolean!]!` for a single flag)
- No OpenAPI spec or TypeScript type generation for the GraphQL schema
- Introspection is rate-limited, so discovery must be deliberate

### Neutral

- REST v2 remains the workhorse for CRUD — this decision doesn't replace it, it establishes priority for new work
- The Atlassian Gateway (`api.atlassian.com/graphql`) remains in use for cross-product queries (backlinks, forward links) via the separate `GraphQLClient`
- Two GraphQL endpoints coexist: AGG for graph traversal, `/cgraphql` for Confluence mutations

## Alternatives Considered

- **Stay REST-only**: simpler, but archive/unarchive literally don't work via REST. The 403 on archived page PUT and the rejection of `status: 'archived'` on v2 PUT are not permission issues — they're API design boundaries.
- **Use AGG for everything**: the Atlassian Gateway doesn't expose the same mutations as `/cgraphql`. `bulkArchivePages` and `movePageAppend` are Confluence-specific mutations not available on AGG.
- **Wait for formal GraphQL API**: Atlassian has not announced a timeline for a public Confluence GraphQL API. The UI has been using `/cgraphql` in production for years. Waiting means archive/unarchive remain impossible.
