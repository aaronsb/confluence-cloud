---
status: Draft
date: 2026-03-20
deciders:
  - aaronsb
related:
  - ADR-300
  - ADR-301
  - ADR-101
---

# ADR-304: Scratchpad Buffer — Line-Addressed Content Authoring

## Context

ADR-301 introduced session-based editing with block-level change tracking. While this works for targeted patches to existing pages (modify a section, replace a block), two authoring patterns expose a flow impediment:

**1. Net-new page creation** — `manage_confluence_page create` immediately hits the Confluence API, producing an empty page. The LLM must then `pull_for_editing` the empty page back, compose content through block operations, and `sync`. This round-trips through the API for a page that has no content yet.

**2. Large content composition** — When writing or rewriting significant portions of a page, the block-level editing operations in `edit_confluence_content` require passing full block content in every tool call. A paragraph edit means sending the entire paragraph text. A section rewrite means sending the entire section. This consumes tokens proportional to total content size, not to the size of the change.

The root cause: **the editing session operates at the block (structural) level, but the LLM thinks and composes at the text (line) level.** The block model (ADR-300) is the right intermediate representation for ADF round-tripping, but it's the wrong editing interface for incremental content authoring.

### What we observe in practice

- Creating a page with 20 paragraphs requires ~20 large `append` tool calls, each carrying full paragraph text
- Fixing a typo requires `window_edit` (which works) but adding a sentence to a paragraph requires `patch_block` with the full block content
- The LLM cannot "see its work" without calling `list_blocks`, which renders the full page every time
- Failed syncs lose no data (the session persists), but the error surface is at the ADF level — the LLM gets opaque serialization errors rather than actionable line-level feedback

### Reference patterns

- **Claude Code's Edit tool**: line-addressed file editing — the LLM specifies old_string/new_string, operates on lines, never sends full files
- **texflow-mcp**: fragment-based editing with line-range addressing within LaTeX documents
- Both demonstrate that **line-level addressing reduces tool call payload size by 5-10x** compared to full-content replacement

## Decision

Introduce a **scratchpad buffer** as the primary content authoring interface. The scratchpad is a line-addressed, in-memory text buffer that sits in front of the existing block/ADF pipeline:

```
┌─────────────────────────────────────────────────────────┐
│  LLM Tool Calls (small, line-addressed)                 │
│    insert_lines, replace_lines, remove_lines, view      │
└──────────────────┬──────────────────────────────────────┘
                   │
         ┌─────────▼──────────┐
         │  Scratchpad Buffer  │  ← text lines[], in memory
         │  (line-addressed)   │
         └─────────┬──────────┘
                   │  submit
         ┌─────────▼──────────┐
         │  Directive Parser   │  ← parseDirectives() from ADR-300
         │  (markdown → blocks)│
         └─────────┬──────────┘
                   │
         ┌─────────▼──────────┐
         │  ADF Serializer     │  ← serializeBlocks() from ADR-300
         │  (blocks → ADF)     │
         └─────────┬──────────┘
                   │
         ┌─────────▼──────────┐
         │  Confluence API     │  ← create or update (with version)
         └────────────────────┘
```

### Scratchpad lifecycle

```
1. CREATE/LOAD:  Create empty scratchpad (new page) or load from existing page
                 → Returns scratchpad ID + target binding
2. EDIT:         Line-based operations on the text buffer (no API calls)
3. VIEW:         See current content with line numbers (windowed or full)
4. SUBMIT:       Parse → validate → serialize → push to Confluence
                 On failure: scratchpad persists, error returned with line context
                 On success: scratchpad invalidated, page ID returned
```

### Scratchpad data model

```typescript
interface Scratchpad {
  id: string;                    // unique buffer ID
  lines: string[];               // the text content, line-addressed
  target: ScratchpadTarget;      // where this content goes
  createdAt: Date;
  lastModified: Date;
}

type ScratchpadTarget =
  | { type: 'new_page'; spaceId: string; title: string; parentId?: string }
  | { type: 'existing_page'; pageId: string; version: number; title: string };
```

### Newline convention

The `content` parameter in line operations accepts multi-line text. Lines are split on `\n` (LF). The scratchpad normalizes all input: `\r\n` (CRLF) and bare `\r` (CR) are converted to `\n` on ingestion. Internally, the buffer stores one string per line with no trailing newline characters. This means:

- `content: "line one\nline two\nline three"` inserts 3 lines
- `content: "single line"` inserts 1 line
- `content: ""` inserts 1 empty line

This matches how LLMs naturally produce text — newline characters delimit lines, and the scratchpad splits on them.

### Line-based operations

| Operation | Args | Effect |
|-----------|------|--------|
| `view` | `scratchpadId`, `startLine?`, `endLine?` | Returns content with line numbers + validation status |
| `insert_lines` | `scratchpadId`, `afterLine`, `content` | Insert text after line N (0 = beginning) |
| `append_lines` | `scratchpadId`, `content` | Append text at end |
| `replace_lines` | `scratchpadId`, `startLine`, `endLine`, `content` | Replace line range with new content |
| `remove_lines` | `scratchpadId`, `startLine`, `endLine?` | Remove line(s) |
| `submit` | `scratchpadId`, `message?` | Parse, validate, push to Confluence |
| `discard` | `scratchpadId` | Invalidate and clear the buffer |
| `list` | — | List all active scratchpads |

Line numbers are 1-based to match the `view` display, consistent with how editors and the Claude Code Edit tool present line numbers.

### RawAdfBlock preservation

When loading an existing page into a scratchpad, `RawAdfBlock` nodes (unsupported ADF content that passed through as an escape hatch in ADR-300) must survive the round-trip through text. The scratchpad renders them as bodyless directives using existing `:::` syntax:

```
:::raw_adf{hash="a1b2c3"}:::
```

The scratchpad maintains a side-table mapping `hash → AdfNode`, populated at load time from the parsed blocks. On submit, `parseDirectives()` recognizes the `raw_adf` directive and reconstructs the `RawAdfBlock` by looking up the stored ADF node by hash.

This approach:
- Uses existing directive syntax — no new pattern for the LLM to learn
- Is visible in the buffer — the LLM can see and position around it
- Round-trips cleanly — if the line is preserved, the ADF is preserved
- Fails gracefully — if the LLM deletes the sentinel line, the raw ADF is intentionally removed

The side-table is scoped to the scratchpad instance and cleared on invalidation.

### Mutation response format

Every mutation response includes three parts: operation confirmation, a context marker showing the edit site, and validation status.

```
Inserted 3 lines after line 5. Buffer: 28 lines.
  5 | existing line above
  6 | first inserted line
  8 | last inserted line
  9 | existing line below
Status: valid
```

The context marker shows one line of surrounding context plus the first and last affected lines. For edits spanning more than 2 lines, intermediate lines are elided. For single-line edits:

```
Replaced lines 12-12. Buffer: 26 lines.
 11 | line before
 12 | the replacement line
 13 | line after
Status: valid
```

For `remove_lines`, the marker shows the join point:

```
Removed lines 8-10. Buffer: 23 lines.
  7 | line before removed range
  8 | line after removed range (was line 11)
Status: invalid at line 20 — unclosed directive block
```

This gives the LLM enough to confirm edit placement without returning the full buffer. The `view` operation is available when broader context is needed.

### Validate-on-mutate

Every mutation operation (`insert_lines`, `append_lines`, `replace_lines`, `remove_lines`) and the `view` operation validate the full scratchpad buffer. The validation status is always the last line of the response:

```
Inserted 3 lines after line 5. Buffer: 28 lines.
Status: valid
```

```
Replaced lines 12-14. Buffer: 26 lines.
Status: invalid at line 12 — unclosed directive block
```

**Validation feedback structure:**

| Buffer state | Status line |
|-------------|-------------|
| Parses cleanly, all blocks well-formed | `Status: valid` |
| Parse error (unclosed directive, malformed table, etc.) | `Status: invalid at line N — {description}` |
| Empty buffer | `Status: empty` |

The status is **informational, not directive**. It does not tell the LLM what to do — it reports the current parse state. An `invalid` status does not mean "stop and fix this now." The LLM may be mid-composition: writing content top-to-bottom, filling in sections out of order, or pasting a scaffold it intends to refine. All of these workflows naturally pass through invalid intermediate states. The validation simply reports where the parser stopped being happy, so when the LLM is ready to submit, it has a signal.

Different authoring styles are equally valid:
- **One-shot**: `append_lines` with complete content → `valid` → `submit`
- **Scaffold-then-refine**: `append_lines` with outline → `invalid` (expected) → progressive edits → `valid` → `submit`
- **Incremental**: many small `insert_lines` calls, ignoring status until ready → check final status → fix if needed → `submit`

The validation runs the same `parseDirectives()` pipeline that `submit` uses, so `valid` means `submit` will not fail at the parse stage (it could still fail at the Confluence API level — version conflict, permissions, etc.).

### Integration with existing tools

**`manage_confluence_page` changes:**

- `create` — No longer calls the Confluence API. Creates a scratchpad bound to `{ type: 'new_page', spaceId, title, parentId }`. Returns:
  ```
  Page prepared: "My New Page"
  Scratchpad: sp-abc123
  Edit the scratchpad, then submit to create the page.
  ```

- `pull_for_editing` — Fetches page, parses ADF → blocks → renders to markdown text, loads into scratchpad bound to `{ type: 'existing_page', pageId, version }`. Returns scratchpad ID with content displayed.

**`edit_confluence_content` changes:**

The tool gains scratchpad operations alongside (or replacing) the current block operations. The `sessionHandle` parameter becomes `scratchpadId`.

### Submit flow

Because validate-on-mutate catches parse/structural errors before submission, `submit` is primarily about the Confluence API call. The pipeline still runs the full parse → serialize → push sequence as a safety net, but in normal use the content has already been validated:

1. **Parse**: `parseDirectives(scratchpadContent)` — should succeed (already validated). If it fails (e.g., buffer was loaded externally), returns line-level error and scratchpad persists.
2. **Serialize**: `serializeBlocks(blocks)` → ADF document.
3. **Push**: Create page (new target) or update page (existing target with version number) via Confluence API.
4. **On success**: Scratchpad is invalidated. Returns page ID, version, and confirmation.
5. **On API failure**: Scratchpad persists. Error is reported with Confluence context:

```
Submit failed: Version conflict — page was modified since pull (version 12).
Scratchpad sp-abc123 is still active.
Options: re-pull to get latest, or discard and start over.
```

```
Submit failed: Permission denied — user lacks write access to space XYZ.
Scratchpad sp-abc123 is still active.
```

The scratchpad always survives a failed submit. Content is never lost due to an API error.

### Relationship to SessionManager (ADR-301)

The scratchpad **replaces** the SessionManager as the LLM-facing editing interface. The block-level session concept is absorbed:

- **Change tracking**: Not needed at the block level. The scratchpad is the single source of truth. On submit, we parse the full text to blocks and serialize to ADF. Confluence's version locking handles conflicts.
- **Delta sync**: The current `sync` operation already serializes all non-deleted blocks to a full ADF document (the Confluence API requires full-body PUT). Block-level delta tracking was an optimization that didn't materialize because the API doesn't support partial updates.
- **Session timeout**: Scratchpads use the same 30-minute inactivity timeout.
- **Multiple sessions**: Multiple scratchpads can coexist (different pages).

The `SessionManager` class can be retired or reduced to an internal implementation detail. The scratchpad is the new session.

### Token efficiency analysis

Current flow (block-level) — creating a page with a heading, 3 paragraphs, and a table:
```
Tool call 1: create page (API round-trip)
Tool call 2: pull_for_editing (API round-trip)
Tool call 3: append — heading content (~50 tokens in args)
Tool call 4: append — paragraph 1 (~200 tokens in args)
Tool call 5: append — paragraph 2 (~200 tokens in args)
Tool call 6: append — paragraph 3 (~200 tokens in args)
Tool call 7: append — table content (~300 tokens in args)
Tool call 8: sync (API round-trip)
Total: 8 tool calls, 3 API round-trips, ~950 tokens in content args
```

Scratchpad flow (line-level) — same content:
```
Tool call 1: create (no API call, returns scratchpad ID)
Tool call 2: append_lines — all content at once (~400 tokens in args)
Tool call 3: submit (single API call — create page with content)
Total: 3 tool calls, 1 API round-trip, ~400 tokens in content args
```

For edits to an existing page (fix typo + add paragraph):
```
Current: pull_for_editing → window_edit → append (full paragraph) → sync = 4 calls
Scratchpad: pull_for_editing → replace_lines (1 line) → insert_lines (2 lines) → submit = 4 calls
Token savings: replace_lines sends ~20 tokens vs patch_block sending ~200 tokens
```

## Consequences

### Positive

- Token-efficient: line-level operations send only the changed text, not full blocks
- Fewer API round-trips: new page creation is a single API call (on submit) instead of three
- Natural editing model: matches how LLMs think about text composition — write lines, revise lines
- Ambient validation: every edit returns parse status as a terse signal — the LLM can act on it or ignore it depending on its authoring stage
- Submit confidence: when the LLM is done editing, the status already tells it whether `submit` will parse cleanly — no separate validation step
- Composable: the LLM can write large content in one `append_lines` or incrementally — its choice
- Deferred creation: new pages don't exist on Confluence until content is ready
- Content never lost: scratchpad survives failed submits, the LLM can fix and retry

### Negative

- Line-based editing loses structural awareness — the scratchpad doesn't know about sections or blocks between mutations (only at validation boundaries)
- The scratchpad text format (markdown with directives) becomes load-bearing — parser bugs directly affect authoring
- Validation runs on every mutation — must be fast (the directive parser is already O(n) on line count, so this is acceptable for typical page sizes)
- Retiring SessionManager means block-level operations (`patch_section`, `patch_block`) need migration or removal

### Neutral

- The scratchpad format is the same markdown+directives format already used in the block renderer and directive parser — no new format to learn
- Existing `pull_for_editing` flow maps directly: ADF → blocks → rendered markdown → scratchpad lines
- The content pipeline (directive parser → block model → ADF serializer) is unchanged — the scratchpad just feeds it differently
- `RawAdfBlock` content from existing pages renders as `:::raw_adf{hash="..."}:::` sentinel lines — visible in the scratchpad, round-trips through submit via a hash-keyed side-table

## Alternatives Considered

- **Keep block-level editing, optimize payloads**: Could add "edit block content at line range" operations to the existing session. But this layers line addressing on top of block addressing — two coordinate systems. The scratchpad is simpler: one coordinate system (lines), structural parsing deferred to validation.

- **Validate only on submit (late validation)**: Simpler implementation, but the LLM has no signal about content correctness until it tries to push. This means wasted submit attempts and opaque errors. Validate-on-mutate is cheap (one parse pass per edit) and gives immediate, actionable feedback.

- **Hybrid: scratchpad for new pages, sessions for existing**: Reduces scope but creates two editing mental models. The LLM (and the user) would need to know which path they're on. Unified is better.

- **Stream content directly to Confluence (no buffer)**: Would require multiple API calls for incremental authoring, and any failure mid-stream leaves partial content on the live page. The buffer pattern explicitly decouples composition from publication.

- **Use Confluence drafts**: Confluence has a draft/publish model, but the API support for draft editing is limited and doesn't give us line-level addressing. We'd still need a local buffer.
