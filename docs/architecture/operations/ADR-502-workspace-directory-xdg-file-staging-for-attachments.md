---
status: Draft
date: 2026-03-20
deciders:
  - aaronsb
related:
  - ADR-303
  - ADR-304
  - ADR-100
---

# ADR-502: Workspace Directory — XDG File Staging for Attachments

## Context

The `manage_confluence_media` tool can upload attachments (from base64 content) and list/download attachments on a page. However, there is no local staging area for file operations that span multiple steps:

- **Copy attachment between pages**: Download from page A, upload to page B. Currently impossible — download returns metadata but there's nowhere to put the bytes, and upload requires base64 content in the tool call.
- **Process and re-upload**: Download an image, have another tool resize/annotate it, upload the result. Requires a filesystem staging point.
- **Bulk operations**: Download several attachments, then upload them elsewhere. Each needs to persist between tool calls.

### Coupling with scratchpad buffer (ADR-304)

ADR-304 introduced deferred page creation — `create` returns a scratchpad instead of immediately creating a page on Confluence. This creates a gap for media-rich pages: you cannot upload an attachment to a page that does not yet exist. Without a staging area, the authoring flow for a page with images is:

1. Submit scratchpad (creates the page)
2. Now upload attachments (page exists)
3. Pull the page back, edit to reference the new attachments
4. Submit again

This defeats the purpose of deferred creation. With a workspace, the flow becomes:

1. Stage images in workspace
2. Compose page in scratchpad, referencing staged files
3. Submit scratchpad → creates page → uploads staged attachments → wires references

The workspace and scratchpad together form a **complete local authoring environment** — text content in the scratchpad, binary assets in the workspace, both published atomically on submit.

### Reference implementation

The `google-workspace-mcp` server (`/home/aaron/Projects/ai/mcp/google-workspace-mcp`) solves this with an XDG-compliant workspace directory:
- Default path: `~/.local/share/google-workspace-mcp/workspace/`
- Configurable via `WORKSPACE_DIR` environment variable
- Sandboxed: path traversal prevention, symlink escape detection, filename sanitization
- Simple CRUD tool: `manage_workspace` with `list`, `read`, `write`, `delete` operations
- Integration: `download` saves to workspace, `upload` reads from workspace

This pattern is proven across multiple MCP servers in the same family.

## Decision

Add an XDG-compliant workspace directory to the Confluence Cloud MCP server as a file staging area for attachment and media operations, integrated with the scratchpad buffer for atomic page-with-media authoring.

### Directory structure

```
~/.local/share/confluence-cloud-mcp/
  workspace/          <- staging area for file operations
```

Default path follows XDG Base Directory Specification:
- `$XDG_DATA_HOME/confluence-cloud-mcp/workspace/` if `XDG_DATA_HOME` is set
- `~/.local/share/confluence-cloud-mcp/workspace/` otherwise
- `$WORKSPACE_DIR` overrides everything if set

### Workspace tool

A new `manage_workspace` tool with four operations:

| Operation | Args | Effect |
|-----------|------|--------|
| `list` | -- | List staged files with sizes |
| `read` | `filename` | Return file content (inline for small text files, path reference for large/binary) |
| `write` | `filename`, `content` | Write content to workspace |
| `delete` | `filename` | Remove a staged file |

### Security sandbox

All workspace file operations are sandboxed:

1. **Path traversal prevention**: Filenames are sanitized (no `../`, no path separators, no null bytes). Resolved paths must remain within the workspace directory.
2. **Symlink escape detection**: After resolution, `fs.realpath()` verifies the actual path is still within the workspace.
3. **Forbidden paths**: The workspace directory itself must not be the home directory, `~/Documents`, `~/Downloads`, or a cloud sync mount.
4. **Lazy creation**: The workspace directory is created on first use with `recursive: true`.

### Integration with media operations

The existing `manage_confluence_media` tool gains workspace awareness:

- `download` writes the attachment to the workspace and returns the filename
- `upload` accepts a `workspaceFile` parameter as an alternative to base64 `content` — reads the file from workspace before uploading

This enables the copy-between-pages flow:
```
1. manage_confluence_media download att:123  ->  saves "diagram.png" to workspace
2. manage_confluence_media upload pageId:456 workspaceFile:"diagram.png"
```

### Integration with scratchpad submit (ADR-304)

The scratchpad's `submit` operation gains media awareness. When a scratchpad targets a new page and the workspace contains files referenced in the content:

1. Submit parses scratchpad content to blocks
2. Submit creates the page on Confluence (text content only)
3. Submit uploads staged workspace files as attachments to the new page
4. Submit updates media block references with the new attachment IDs

For existing pages, attachment uploads happen before the content update so that media references resolve correctly.

The scratchpad can reference workspace files using a media directive:
```
:::media{file="diagram.png" alt="Architecture diagram"}:::
```

On submit, this resolves to a `MediaBlock` with the attachment ID from the upload. If the file is not in the workspace, submit reports an error with the missing filename — the scratchpad persists for correction.

### Containerization awareness

Some MCP clients run the server in a sandbox where the client cannot read the server's filesystem. For small text files (< 100KB), the workspace `read` operation returns content inline in the response. For large or binary files, it returns the path — the content is accessible via subsequent `upload` or `submit` operations within the same MCP session.

## Consequences

### Positive

- Enables multi-step file operations: download, process, upload
- Cross-page attachment copying becomes a two-step flow
- Scratchpad + workspace = complete local authoring environment for media-rich pages
- Atomic publish: text and images submitted together, not in separate passes
- XDG compliance: predictable, user-configurable paths
- Sandboxed: path traversal and symlink escape prevention
- Consistent with google-workspace-mcp pattern

### Negative

- Server now writes to the local filesystem — must handle permissions, disk space
- Workspace files persist between sessions unless explicitly deleted — need cleanup guidance
- Submit with media uploads adds complexity: create page, upload files, update references
- Binary file content in workspace is not visible in MCP tool responses (only text files inline)

### Neutral

- The workspace is optional — existing base64 upload/download flows continue to work
- File size limits should match Confluence's attachment size limits
- The workspace directory persists across MCP server restarts
- The `:::media{file="..."}:::` directive is only recognized during submit — it is not valid Confluence content and must resolve to an actual attachment

## Alternatives Considered

- **In-memory file staging**: Store downloaded files in server memory. Simpler, but memory-constrained and lost on restart. Doesn't work for large files or across sessions. Rejected.

- **Base64 round-trip only**: Keep current pattern where upload requires base64 in the tool call. Works for single-step operations but cannot bridge download -> upload across tool calls. The LLM would need to hold binary content in context. Rejected.

- **Temp directory (`/tmp`)**: Use system temp. No XDG compliance, no consistent location, may be cleaned by OS at any time. Rejected.

- **Decouple workspace from scratchpad**: Keep them as independent features. Functional but misses the atomic publish opportunity — media-rich pages would still require multiple passes. The coupling is the point.
