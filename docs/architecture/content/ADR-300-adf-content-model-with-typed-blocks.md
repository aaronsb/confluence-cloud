---
status: Draft
date: 2026-03-18
deciders:
  - aaronsb
related:
  - ADR-100
  - ADR-301
  - ADR-302
---

# ADR-300: ADF Content Model with Typed Blocks

## Context

Confluence Cloud v2 API uses Atlassian Document Format (ADF) — a deeply nested JSON AST — as its native content representation. ADF is powerful but hostile to LLMs:
- Deeply nested JSON with verbose node types
- Macros represented as `extension` nodes with opaque parameter maps
- No markdown equivalent for many constructs (status macros, expand blocks, info panels)
- Round-trip fidelity is critical — lossy conversion destroys page structure

Our reference projects demonstrate that an **intermediate content model** between the native format and the LLM-facing representation is essential:
- **texflow-mcp**: typed dataclasses (Section, Figure, Table, CodeBlock, RawLatex) with round-trip serialization to/from LaTeX
- **wordpress-mcp**: block objects (type, attributes, content, position) with round-trip serialization to/from Gutenberg HTML
- **obsidian-mcp**: fragments with semantic segments and chunks for addressing content within documents

The LLM should never see raw ADF. It should never produce raw ADF. The content model is the boundary.

## Decision

Define a **typed block model** as the intermediate representation between ADF and the LLM:

```typescript
type Block =
  | SectionBlock      // heading + nested content
  | ParagraphBlock    // text with inline marks
  | TableBlock        // structured rows/columns
  | CodeBlock         // language + code string
  | MacroBlock        // typed macro (see ADR-302)
  | MediaBlock        // image/file reference
  | ListBlock         // ordered/unordered with items
  | RawAdfBlock;      // escape hatch for unsupported nodes

interface SectionBlock {
  type: 'section';
  heading: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  content: Block[];   // recursive nesting
  id?: string;        // stable identifier for patch addressing
}

interface MacroBlock {
  type: 'macro';
  macroId: string;    // e.g., 'status', 'info', 'code', 'expand'
  params: Record<string, string>;
  body?: Block[];     // macros with body content (panels, expand)
  id?: string;
}

interface RawAdfBlock {
  type: 'raw_adf';
  adf: object;        // verbatim ADF node, passed through unchanged
  hint?: string;       // human-readable description for the LLM
}
```

**Bidirectional bridge**:
- **ADF → Block Model**: `parseAdf(adfDocument) → Block[]` walks the ADF tree, maps nodes to typed blocks, falls back to `RawAdfBlock` for unrecognized nodes
- **Block Model → ADF**: `serializeBlocks(blocks) → AdfDocument` reconstructs valid ADF from typed blocks, passes `RawAdfBlock` through verbatim

**LLM-facing rendering**: The block model renders to a markdown-like format with `:::` directive syntax for macros (inspired by texflow's block representation and the CommonMark generic directives proposal):

```markdown
## API Changes

Some introductory text about the changes.

:::status{color="red" title="Breaking"}:::

:::panel{type="warning" title="Migration Required"}
Users on v1 must update their auth tokens before March 30.
:::

| Header A | Header B |
|----------|----------|
| cell 1   | cell 2   |
```

**ADF libraries**: `@atlaskit/adf-utils` for traversal/building, `@atlaskit/adf-schema` for TypeScript types, and a markdown conversion layer (likely custom, as `marklassian` handles standard nodes but not macros).

## Consequences

### Positive

- LLMs work with a clean, readable format — no JSON AST manipulation
- Macro blocks are typed with parameter schemas — validation before serialization
- `RawAdfBlock` escape hatch ensures no ADF content is silently dropped
- Section-based addressing enables structural patch editing (ADR-301)
- The block model is the single source of truth during an editing session (ADR-301)

### Negative

- Two conversion steps (ADF → blocks → markdown) introduce potential fidelity loss
- Must maintain the ADF parser as Atlassian evolves ADF schema versions
- Complex ADF nodes (nested tables, multi-body macros) require careful mapping
- `@atlaskit` packages are designed for browser use — may need tree-shaking or selective imports for Node.js

### Neutral

- The block model is serializable to JSON for session persistence
- Unknown ADF nodes pass through as `RawAdfBlock` — no data loss, but the LLM sees an opaque hint instead of structured content
- The `:::` directive rendering format is custom to this server but parseable and learnable by LLMs

## Alternatives Considered

- **ADF-to-markdown only** (no intermediate model): loses macro structure, tables degrade, no structural addressing. Markdown is a rendering format, not an editing model.
- **Expose raw ADF to the LLM**: ADF is verbose JSON — a simple page consumes thousands of tokens. LLMs produce invalid ADF. Rejected outright.
- **Storage format (XHTML)**: Confluence legacy format. Even more hostile to LLMs than ADF. Atlassian is deprecating it.
- **Wiki markup**: Confluence Cloud v2 APIs no longer support wiki markup.
