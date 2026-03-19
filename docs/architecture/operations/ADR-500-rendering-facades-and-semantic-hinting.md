---
status: Draft
date: 2026-03-18
deciders:
  - aaronsb
related:
  - ADR-100
  - ADR-101
---

# ADR-500: Rendering Facades and Semantic Hinting

## Context

Raw API responses are hostile to LLMs — verbose JSON, redundant fields, unstable key ordering, deeply nested structures. The jira-cloud MCP server demonstrates that a **rendering facade** (converting structured data to token-efficient markdown) combined with **semantic next-step hints** (suggesting what the LLM should do next) dramatically improves usability.

Key patterns from jira-cloud:
- Core fields in pipe-delimited format: `TYPE | STATUS | PRIORITY | ASSIGNEE`
- Status icons: `[x]` (done), `[>]` (in progress), `[ ]` (to do)
- Last 5 comments shown, total count indicated
- Every response ends with contextual next-step suggestions
- Efficiency hints when the LLM could batch operations

Key patterns from obsidian-mcp:
- Workflow hints based on current operation context
- Suggested actions list tailored to the result type
- Snippet extraction for search results (not full documents)

Key patterns from wordpress-mcp:
- Semantic context in responses (block type counts, empty block detection)
- Suggested actions list with specific tool names
- Workflow guidance strings summarizing document state

## Decision

Every tool response passes through a **rendering facade** before returning to the LLM. No tool ever returns raw JSON.

**Rendering principles**:

1. **Minimal tokens, maximum clarity**:
   - Page metadata: `📄 Page Title | SPACE-KEY | current | v3 | Mar 15 by @alice`
   - Space summary: `🏠 Engineering (ENG) | 142 pages | 12 blog posts`
   - Search results: title + excerpt snippet + labels (not full page bodies)

2. **Progressive detail via expand** (per ADR-400 pattern):
   - Default page get: title, space, status, version, dates
   - `expand: ['body']`: rendered markdown content with macro blocks
   - `expand: ['labels']`: label list
   - `expand: ['history']`: version history with authors and change summaries
   - `expand: ['restrictions']`: permission summary

3. **Semantic next-step hints** appended to every response:
   ```markdown
   ---
   **Next steps:**
   - Edit this page: `edit_confluence_content` — `{"sessionHandle": "...", "operation": "patch_section", ...}`
   - View child pages: `navigate_confluence` — `{"operation": "children", "pageId": "..."}`
   - Search related: `search_confluence` — `{"operation": "by_label", "labels": ["api"]}`
   ```

4. **Context-aware hints** — different operations suggest different next steps:
   - After **create**: suggest editing content, adding labels, setting parent
   - After **search**: suggest drilling into results, refining CQL, narrowing by label
   - After **navigate tree**: suggest editing a specific page, creating a child
   - After **edit sync**: suggest viewing updated page, checking backlinks for impact

5. **Efficiency hints** (from jira-cloud's queue pattern):
   - After 3+ consecutive single-page operations: suggest `queue_confluence_operations`
   - When search returns many results: suggest CQL refinement
   - When tree is deep: suggest narrowing with depth/maxNodes

**MCP Resources** for stable reference data:

| Resource | Content |
|----------|---------|
| `confluence://instance/summary` | Instance stats, available spaces |
| `confluence://spaces/{key}/overview` | Space overview, page count, recent activity |
| `confluence://macros` | Available macro registry with parameter schemas (ADR-302) |
| `confluence://tools/{name}/documentation` | Per-tool detailed documentation and examples |

## Consequences

### Positive

- LLMs consume fewer tokens per response — more room for reasoning and multi-step workflows
- Next-step hints reduce tool discovery overhead — LLM knows what to do next without re-reading tool schemas
- Consistent rendering format across all tools — predictable, parseable output
- Efficiency hints prevent wasteful patterns (repeated single calls → suggest batching)
- Progressive disclosure means simple queries stay cheap

### Negative

- Rendering facade must evolve alongside API changes
- Hints can become stale if server state changes between responses
- Custom markdown format requires LLM learning (though it's intuitive)
- Facade hides raw data that might occasionally be useful for debugging

### Neutral

- All output is `text/markdown` MCP content type — consistent with jira-cloud
- Resources provide stable reference data; tool responses provide dynamic operational data
- Rendering is the last step before return — all internal logic works with typed objects, not strings

## Alternatives Considered

- **Return raw JSON**: maximum fidelity but consumes 5-10x more tokens. LLMs struggle with deeply nested JSON. Rejected.
- **Return both JSON and markdown**: doubled response size without clear benefit. If raw data is needed, a debug flag can be added later.
- **No hints** (let LLM discover workflows): works for expert users but forces every LLM to re-discover multi-step patterns. Hints are cheap to append and high-value.
- **Static hints** (same suggestions every time): misses context. "After creating a page, suggest adding content" is useful; "after searching, suggest creating a page" is noise. Context-aware hints are worth the implementation cost.
