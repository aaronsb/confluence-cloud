---
status: Draft
date: 2026-03-18
deciders:
  - aaronsb
related:
  - ADR-100
  - ADR-400
  - ADR-201
---

# ADR-200: Hybrid REST and GraphQL Client

## Context

Atlassian is actively migrating Confluence Cloud APIs from REST to GraphQL. The current reality is hybrid:

| API Surface | REST v2 | GraphQL Gateway |
|-------------|---------|-----------------|
| Page CRUD | Full support | Beta (growing) |
| CQL Search | Full support | Wrapped (confluence_search) |
| Attachments | Full support | Limited |
| Spaces | Full support | Available |
| Page hierarchy | Available but multi-request | Native (single query) |
| Cross-product links | Not available | Native (Jira+Confluence in one query) |
| Permissions graph | Per-entity REST calls | Traversable relationships |
| User/group relationships | Separate endpoints | Graph-native |

Existing TypeScript libraries (`confluence.js`, `@resolution/confluence-api-client`) are REST-first and don't support the GraphQL gateway. Building exclusively on them creates technical debt as Atlassian migrates endpoints.

Our atlassian-graph project demonstrates that the GraphQL gateway is production-ready for relationship queries, cross-product search, and permission traversal — operations that require multiple REST round-trips. It also reveals the hybrid reality: JQL is JQL, CQL is CQL, even when wrapped in GraphQL.

## Decision

Build a **dual-adapter client** that abstracts transport from the tool layer:

```typescript
interface ConfluenceClient {
  // The tool layer calls these — transport is invisible
  getPage(id: string, expand?: string[]): Promise<Page>;
  getPageHierarchy(id: string, depth: number): Promise<PageTree>;
  search(cql: string, options?: SearchOptions): Promise<SearchResult>;
  getLinkedContent(pageId: string): Promise<LinkedContent>;
}

class ConfluenceClientImpl implements ConfluenceClient {
  private rest: RestV2Adapter;    // confluence.js or direct HTTP
  private graph: GraphQLAdapter;  // graphql-request against gateway

  async getPage(id, expand) {
    return this.rest.getPage(id, expand);  // REST is richer for single-entity
  }

  async getPageHierarchy(id, depth) {
    return this.graph.getPageHierarchy(id, depth);  // GraphQL avoids N+1
  }
}
```

**Routing heuristic**: Use REST v2 for single-entity CRUD and CQL search. Use GraphQL for relationship traversal, cross-product queries, and permission checks. The routing is internal — tools don't know which transport serves them.

**Primary libraries**:
- `confluence.js` (by MrRefactoring, same author as `jira.js` used in jira-cloud MCP) for REST adapter
- `graphql-request` for GraphQL adapter

**Auth**: Single OAuth 2.0 / API token credential shared by both adapters. Both APIs authenticate against `api.atlassian.com`. Environment variables following the jira-cloud pattern:
- `CONFLUENCE_API_TOKEN`
- `CONFLUENCE_EMAIL`
- `CONFLUENCE_HOST`

**cloudId resolution**: GraphQL requires a cloudId (not hostname). The client resolves this once at startup via `https://your-instance.atlassian.net/_edge/tenant_info` and caches it.

## Consequences

### Positive

- As Atlassian migrates endpoints to GraphQL, we shift routing without changing tools
- Relationship queries are dramatically more efficient via GraphQL (1 query vs N+1 REST calls)
- Cross-product queries become possible (Jira issues linked to a Confluence page)
- `confluence.js` provides excellent TypeScript types for REST operations
- Same auth pattern as jira-cloud MCP — familiar to users of both servers

### Negative

- Two API clients to maintain, test, and handle errors for
- GraphQL schema may change (currently beta for some operations)
- Must manage cloudId resolution for GraphQL (REST uses host directly)
- Error shapes differ between REST and GraphQL — client must normalize both

### Neutral

- The client interface hides transport complexity — if GraphQL becomes comprehensive enough, the REST adapter can be dropped without tool changes
- Rate limiting must account for both API surfaces separately
- The routing heuristic is encoded in the client implementation, not configuration — it changes as API coverage evolves

## Alternatives Considered

- **REST only** (confluence.js exclusively): simpler, but relationship queries require N+1 requests and cross-product queries are impossible. Creates debt as Atlassian deprecates REST endpoints.
- **GraphQL only** (atlassian-graph pattern): coverage gaps — attachments, some CQL features, and content body operations are richer via REST v2. Premature for a production server.
- **Direct HTTP for everything** (no library): maximum control but massive surface area to type and maintain. `confluence.js` types are worth the dependency.
