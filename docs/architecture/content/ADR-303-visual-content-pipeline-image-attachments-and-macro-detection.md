---
status: Draft
date: 2026-03-20
deciders:
  - aaronsb
related:
  - ADR-300
  - ADR-302
  - ADR-500
---

# ADR-303: Visual Content Pipeline — Image Attachments and Macro Detection

## Context

Confluence pages contain visual content that LLMs cannot currently access through this server: embedded images (screenshots, photos, diagrams exported as PNG/SVG) and diagram macros (Mermaid, draw.io, Gliffy). When an agent pulls a page for editing, these visual elements are either invisible (images referenced by attachment ID) or opaque (macro blocks with no indication of what they contain).

The MCP protocol supports returning images as base64-encoded content alongside text. A multimodal LLM like Claude can directly perceive and reason about images in its context. This creates an opportunity: if the server can fetch and deliver visual content as images, the agent gains visual understanding of page content it currently cannot see.

**Two distinct capabilities are needed:**

1. **Image delivery** — Fetch image attachment bytes from Confluence and return them as MCP `image` content (base64 + mimeType). This is a transport concern: the images already exist, we just need to deliver them.

2. **Macro detection** — When parsing ADF, identify diagram and visual macro blocks by their extension key (e.g., `drawio`, `mermaid`, `gliffy`) and surface them with type information. This lets the agent know what kind of visual content is on the page and, for text-based formats like Mermaid, extract the source directly.

**What's out of scope:**

- Native Confluence whiteboards — the API exposes metadata only, no canvas content or export endpoint. Cannot be fetched or rendered programmatically.
- Server-side diagram rendering (e.g., Mermaid text → PNG via `mmdc`) — valuable but a separate concern that can layer on top of this pipeline later.

## Decision

### 1. Image attachment viewing

Add a `view` operation to `manage_confluence_media` that fetches an attachment's bytes and returns them as MCP image content.

```typescript
// New operation on manage_confluence_media
case 'view': {
  // Fetch attachment info for mimeType
  const info = await client.getAttachmentInfo(args.attachmentId);
  // Fetch raw bytes via download URL
  const bytes = await client.downloadAttachment(args.attachmentId);
  return {
    content: [{
      type: 'image',
      data: bytes.toString('base64'),
      mimeType: info.mediaType,
    }],
  };
}
```

**Client addition:**
```typescript
downloadAttachment(id: string): Promise<Buffer>;
```

This uses the existing `downloadUrl` from the attachment metadata. Only image MIME types (`image/*`) are returned as MCP image content; other types return a text description with download info.

**Size guardrails:** Images larger than a configurable threshold (default 5MB) return metadata instead of the full image, with a message suggesting the agent use a smaller version or thumbnail if available.

### 2. Macro block detection in ADF parsing

Enhance the ADF parser to recognize known diagram/visual macro extension keys and tag the resulting `MacroBlock` with a `category` field.

Known macro keys and their categories:

| Extension Key | Category | Source Format | Notes |
|--------------|----------|---------------|-------|
| `mermaid` / `mermaid-cloud` | `diagram:mermaid` | Text (in macro body) | Source is directly extractable |
| `drawio` / `draw.io` | `diagram:drawio` | XML attachment | Requires attachment fetch |
| `gliffy` | `diagram:gliffy` | JSON attachment | Requires attachment fetch |
| `image` / `gallery` | `visual:image` | Attachment reference | Native Confluence image embed |
| `chart` | `visual:chart` | Macro params | Confluence built-in chart |

Add an optional `category` field to `MacroBlock`:

```typescript
interface MacroBlock {
  type: 'macro';
  macroId: string;
  params: Record<string, string>;
  body?: Block[];
  category?: string;  // NEW: e.g., 'diagram:mermaid', 'visual:image'
  id: string;
}
```

The parser populates `category` from a lookup table of known extension keys. Unknown macros get no category (backwards compatible). The renderer shows the category in output:

```
:::mermaid [diagram:mermaid]
graph LR
  A --> B
:::
```

This tells the agent: "this is a Mermaid diagram and the source text is right here."

For draw.io/Gliffy macros, the renderer shows:

```
:::drawio [diagram:drawio]{attachmentId="att123"}:::
```

This tells the agent: "this is a draw.io diagram stored in attachment att123 — use `manage_confluence_media` → `view` to see it."

### 3. Inline image references

When the ADF parser encounters `mediaSingle`/`mediaGroup` nodes (inline images), render them with enough context for the agent to view them:

```
[Image: screenshot.png | att:12345 — use manage_confluence_media view to see]
```

### Flow composition

These primitives compose naturally:

- **"Show me the architecture diagram on page X"** → pull page → detect `diagram:drawio` macro → extract attachment ID → `view` attachment → agent sees the image
- **"What does the Mermaid diagram on this page show?"** → pull page → detect `diagram:mermaid` → source text is in the block → agent reads it directly (no image needed)
- **"Describe all images on this page"** → pull page → find `MediaBlock` entries → `view` each attachment → agent describes them
- **Future: render Mermaid** → detect `diagram:mermaid` → extract source → pipe to `mmdc` → return rendered image (separate ADR)

## Consequences

### Positive

- Agents gain visual perception of Confluence page content for the first time
- Mermaid diagrams are immediately readable as text — no rendering needed
- Image viewing is generic: works for any attachment type (diagrams, screenshots, photos)
- Macro detection is extensible: new diagram types are just lookup table entries
- Composable primitives: detection + viewing can be mixed in queue operations

### Negative

- Large images consume significant context window (a 1MB PNG = ~1.3MB base64)
- Size guardrails may prevent viewing high-resolution diagrams without resizing
- draw.io/Gliffy diagram *content* is only visible as rendered images, not editable structure

### Neutral

- `downloadAttachment` requires authenticated fetch to the Confluence download URL (same auth as existing requests)
- Macro category detection is best-effort — custom/unknown diagram apps won't be categorized until added to the lookup table
- Mermaid source extraction works without any rendering dependency; server-side rendering is a future enhancement

## Alternatives Considered

- **Parse draw.io XML into text descriptions**: Rejected — mxGraph XML is complex, unlikely to be in training data, and the visual rendering conveys more information than a node/edge list. Image delivery is more useful.
- **Render all diagrams server-side**: Rejected for initial scope — adds CLI dependencies (`mmdc`, `drawio`). Better to deliver what we can now (images, Mermaid text) and add rendering as a separate capability later.
- **Whiteboard content access**: Not possible — Atlassian's whiteboard API returns metadata only, no canvas content or export endpoint. Tracked externally (CONFCLOUD-77326).
- **Separate `view_confluence_diagram` tool**: Rejected — viewing images is a media operation. Macro detection is a parsing concern. Both fit existing tools without adding a new one.
