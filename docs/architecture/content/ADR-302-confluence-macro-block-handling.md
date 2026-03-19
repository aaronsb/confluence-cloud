---
status: Draft
date: 2026-03-18
deciders:
  - aaronsb
related:
  - ADR-300
  - ADR-301
---

# ADR-302: Confluence Macro Block Handling

## Context

Confluence macros are the primary extension mechanism — status badges, info panels, code blocks, expand sections, table of contents, Jira issue links, and hundreds of marketplace macros. In ADF, macros are represented as `extension` nodes:
- `extensionType`: `"com.atlassian.confluence.macro.core"` for built-ins
- `extensionKey`: the macro identifier (e.g., `"status"`, `"info"`, `"code"`)
- `parameters`: key-value map with `{value: string}` wrapping
- Optional body content (panels, expand blocks contain child ADF nodes)

This representation is verbose, opaque to LLMs, and varies by macro type. Without structured handling, the LLM either can't use macros or produces invalid ADF.

Our reference projects solve analogous problems:
- **texflow-mcp**: typed dataclasses per block type + `RawLatex` escape hatch + template discovery + lint validation. The key insight: macros are typed blocks with known parameters, not opaque strings.
- **wordpress-mcp**: block type registry + per-type attribute schemas + format compatibility matrix + immediate validation. The key insight: validate on insert/edit, not at sync time.

## Decision

Implement a **macro registry** with typed schemas for common macros, template discovery, and a safe fallback for unknown types.

**Registry structure**:
```typescript
interface MacroDefinition {
  key: string;                    // e.g., 'status'
  name: string;                   // e.g., 'Status Badge'
  category: MacroCategory;        // 'formatting' | 'navigation' | 'integration' | 'content'
  params: MacroParamSchema[];     // typed parameter definitions
  hasBody: boolean;               // whether macro contains child content
  bodyHint?: string;              // what kind of content the body accepts
  renderHint: string;             // how to represent this to the LLM
}

interface MacroParamSchema {
  name: string;
  type: 'string' | 'enum' | 'boolean' | 'number' | 'page-id' | 'space-key';
  required: boolean;
  values?: string[];              // for enum type
  default?: string;
}
```

**Built-in macro registry** (shipped with server):

| Macro | Key Params | Has Body | LLM Rendering |
|-------|-----------|----------|---------------|
| `status` | color (enum: green/yellow/red/blue/grey), title | No | `:::status{color="red" title="Done"}:::` |
| `info` | title | Yes | `:::panel{type="info"}` content `:::` |
| `note` | title | Yes | `:::panel{type="note"}` content `:::` |
| `warning` | title | Yes | `:::panel{type="warning"}` content `:::` |
| `error` | title | Yes | `:::panel{type="error"}` content `:::` |
| `code` | language, title, collapse | Yes | fenced code block with metadata |
| `expand` | title | Yes | `:::expand{title="..."}` content `:::` |
| `toc` | maxLevel, style, type | No | `:::toc{maxLevel=3}:::` |
| `jira` | key, server | No | `:::jira{key="PROJ-123"}:::` |
| `children` | sort, style, depth | No | `:::children{depth=2}:::` |
| `excerpt` | name, hidden | Yes | `:::excerpt{name="..."}` content `:::` |

**Unknown/marketplace macros** fall through to `RawAdfBlock` with a descriptive hint:
```markdown
:::unknown-macro{key="custom-charts" params={type: "pie", dataSource: "..."}}:::
<!-- Unregistered macro. Use manage_confluence_page to view raw ADF if needed. -->
```

**Validation**: Before serializing a `MacroBlock` to ADF, validate params against the registry schema. Report specific errors ("status macro: 'color' must be one of green/yellow/red/blue/grey, got 'purple'") rather than letting the PUT fail with a generic 400.

**Discovery**: Available macros exposed as MCP resource at `confluence://macros` with parameter schemas and usage examples. LLMs query this to discover capabilities.

**Extensibility**: The registry is a JSON configuration file, not code. Users can register custom/marketplace macros by adding entries to a config file, following the texflow-mcp template pattern.

## Consequences

### Positive

- LLMs can create and edit macros using readable `:::` syntax, not raw ADF extension nodes
- Parameter validation catches errors before API calls with specific, actionable messages
- Registry is extensible via configuration — marketplace macros can be added without code
- Unknown macros pass through safely via `RawAdfBlock` (no data loss)
- The `:::` directive syntax is parseable, round-trips cleanly, and is familiar from Docusaurus/VuePress

### Negative

- Built-in registry must be maintained as Atlassian adds/changes macros
- Marketplace macros need manual registration or accept raw passthrough
- Body-containing macros with nested macros require recursive parsing
- The `:::` directive syntax is a convention, not a standard

### Neutral

- Registry is data (JSON), not code — adding a new macro is a config change
- Macro discovery via MCP resource follows the jira-cloud pattern for custom field discovery
- Some macros (e.g., `jira`) reference external entities — validation can check format but not existence

## Alternatives Considered

- **Markdown-only rendering** (drop macros to text descriptions): loses the ability to create or edit macros. A Confluence server that can't handle macros is fundamentally incomplete.
- **XML/HTML representation**: more verbose than `:::` directives, LLMs produce invalid XML frequently.
- **Generic params map for all macros** (no typed schemas): loses type safety and validation. "color must be one of red/yellow/green" is more useful than "params: any".
- **Runtime macro discovery from Confluence API**: Confluence doesn't expose parameter schemas via API — only macro keys. Registry must include param schemas statically.
