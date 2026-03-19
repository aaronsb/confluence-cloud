---
status: Draft
date: 2026-03-18
deciders:
  - aaronsb
related:
  - ADR-200
  - ADR-300
  - ADR-400
  - ADR-500
---

# ADR-100: Layered Server Architecture

## Context

We are building a Confluence Cloud MCP server that must handle multiple concerns: API transport (REST v2 + GraphQL), content model transformation (ADF to/from LLM-friendly formats), editing sessions, navigation, and operational patterns (batching, hints, facades). A flat architecture would couple these concerns, making it impossible to swap transports or evolve the content model independently.

Our reference implementations demonstrate that layered separation works:
- **jira-cloud**: separates client, handlers, schemas, and rendering
- **obsidian-mcp**: separates semantic routing, graph traversal, content handling, and security
- **texflow-mcp**: separates model, tools, serializer, and ingestion
- **wordpress-mcp**: separates core (sessions, validation, conversion), features, and config

## Decision

Adopt a five-layer architecture where each layer has a single responsibility and communicates only with adjacent layers:

```
┌──────────────────────────────────────────────┐
│  1. MCP Tool Layer                           │
│     Operation dispatch, input validation,    │
│     semantic next-steps appended to output   │
├──────────────────────────────────────────────┤
│  2. Editing Session Layer                    │
│     Pull/edit/validate/sync lifecycle,       │
│     per-block change tracking, delta sync    │
├──────────────────────────────────────────────┤
│  3. Content Model Layer                      │
│     Typed blocks (Section, Macro, Table...),│
│     macro registry, parameter validation,    │
│     ADF <-> block model bridge               │
├──────────────────────────────────────────────┤
│  4. Navigation & Discovery Layer             │
│     Page hierarchy, link graph, label        │
│     topology, CQL search, field discovery    │
├──────────────────────────────────────────────┤
│  5. Transport Layer                          │
│     REST v2 adapter, GraphQL adapter,        │
│     auth, rate limiting, multi-tenancy       │
└──────────────────────────────────────────────┘
```

Each layer is a directory under `src/` with explicit exports. Cross-layer imports go downward only (Tool -> Session -> Content -> Navigation -> Transport).

## Consequences

### Positive

- Transport can evolve (REST deprecation, GraphQL expansion) without touching content model or tools
- Content model changes (new macro types, ADF schema updates) don't affect navigation or transport
- Session layer can be bypassed for read-only operations that don't need change tracking
- Each layer is independently testable with mocked adjacent layers

### Negative

- More files and directories than a flat structure
- Some operations cross multiple layers, requiring careful interface design
- Indirection cost: a simple page read traverses all five layers

### Neutral

- Directory structure mirrors the architecture diagram, making it self-documenting
- Forces explicit decisions about which layer owns each concern

## Alternatives Considered

- **Flat handler pattern** (like early jira-cloud): simpler to start but couples transport to rendering. Rejected because we know from experience this becomes painful as the server grows.
- **Plugin architecture** (like obsidian-mcp): more flexible but over-engineered for a focused Confluence server. We don't need runtime extensibility.
- **Two-layer (tools + client)**: too coarse — the content model and session concerns deserve isolation given ADF complexity.
