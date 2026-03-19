---
status: Draft
date: 2026-03-18
deciders:
  - aaronsb
related:
  - ADR-300
  - ADR-302
  - ADR-101
---

# ADR-301: Session-Based Editing with Delta Sync

## Context

Confluence pages can be large (10KB-100KB+ of ADF). Naive editing requires:
1. Fetch entire page ADF
2. Convert to LLM-friendly format
3. LLM produces entire new content
4. Convert back to ADF
5. PUT entire page body

This is wasteful (token-expensive, bandwidth-heavy) and dangerous (concurrent edit conflicts, version mismatch). The wordpress-mcp project solves this with **BlockDocumentSession** — a session object that tracks per-block changes and syncs only deltas.

Additionally, Confluence Cloud has **optimistic locking** via version numbers. Any update must include the current version number, and the API rejects stale versions. This makes session tracking not just an optimization but a correctness requirement.

## Decision

Implement an **editing session lifecycle** for page content modifications:

```
1. PULL:     Fetch page → parse ADF → Block[] → store original hashes
2. EDIT:     Apply structural edits to blocks (in-memory, validated per-op)
3. VALIDATE: Pre-sync validation of all changed blocks
4. SYNC:     Serialize changed blocks to ADF → PUT with version number
5. CLOSE:    Release session, clear state
```

**Session state**:
```typescript
interface EditingSession {
  sessionId: string;
  pageId: string;
  spaceKey: string;
  version: number;          // Confluence version for optimistic locking
  blocks: SessionBlock[];   // Current state
  originalHashes: Map<string, string>;  // block.id → hash at pull time
  status: 'active' | 'dirty' | 'synced' | 'conflict';
  createdAt: Date;
  lastModified: Date;
}

interface SessionBlock extends Block {
  id: string;               // Stable identifier
  hash: string;             // Current content hash
  state: 'unchanged' | 'modified' | 'inserted' | 'deleted';
}
```

**Key behaviors**:
- Sessions are created by `manage_confluence_page` with `operation: "pull_for_editing"` — returns an opaque `sessionHandle`
- All `edit_confluence_content` operations require a `sessionHandle`
- Read-only operations (`get`) do NOT require sessions — they go direct
- Sessions timeout after 30 minutes of inactivity (configurable)
- Conflict detection: if the page version has advanced since pull, the sync reports a conflict with options to force, merge, or re-pull

**Delta sync logic**:
- Compare each block's current hash against `originalHashes`
- For modified blocks: update in place within the ADF tree
- For inserts/deletes: reconstruct the affected section's ADF
- Use Confluence's version-aware PUT to detect concurrent edits

## Consequences

### Positive

- Token-efficient: LLM only sees/produces the blocks it's editing
- Bandwidth-efficient: API calls send only changed content (though the PUT is full-body, we reconstruct minimally)
- Safe: version-based conflict detection prevents silent overwrites
- Recoverable: session state can be persisted for retry after failures
- Change tracking enables meaningful feedback ("edited section 'API Design', added warning panel")

### Negative

- Session management adds server-side state (cleanup, timeouts, memory)
- Concurrent sessions on the same page need coordination
- Full ADF reconstruction is still needed for the PUT (Confluence doesn't support partial content updates) — but we reconstruct from tracked state, not from scratch
- Session timeout UX: LLM must re-pull if session expires

### Neutral

- Sessions are optional — `manage_confluence_page` `get` works without one
- Session handles are opaque strings, not page IDs — prevents accidental misuse
- The server can support multiple active sessions (different pages) simultaneously

## Alternatives Considered

- **Full page replacement on every edit**: simple but wasteful and conflict-prone. A typo fix shouldn't require the LLM to reproduce 50KB of content. Rejected.
- **Client-side diffing** (LLM computes diff): LLMs are unreliable diff producers. The server must own change tracking. Rejected.
- **Confluence's collaborative editing protocol** (synchrony/NB): internal protocol, not exposed via public API. Not available.
- **No sessions, just PATCH-style partial updates**: Confluence API doesn't support PATCH for content bodies — it's full PUT only. We must implement change tracking ourselves.
