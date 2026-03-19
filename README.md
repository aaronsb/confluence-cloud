# Confluence Cloud MCP Server

A Model Context Protocol server for interacting with Confluence Cloud. Structured page editing with session-based change tracking, native macro support, and graph-based navigation.

## Install

### Claude Desktop (one-click)

Download [`confluence-cloud-mcp.mcpb`](https://github.com/aaronsb/confluence-cloud/releases/latest) and open it — Claude Desktop will prompt for your Confluence credentials.

### Claude Code

```bash
claude mcp add confluence-cloud -e CONFLUENCE_API_TOKEN=your-token -e CONFLUENCE_EMAIL=your-email -e CONFLUENCE_HOST=https://your-team.atlassian.net -- npx -y @aaronsb/confluence-cloud-mcp
```

### Manual (any MCP client)

```json
{
  "mcpServers": {
    "confluence-cloud": {
      "command": "npx",
      "args": ["-y", "@aaronsb/confluence-cloud-mcp"],
      "env": {
        "CONFLUENCE_API_TOKEN": "your-api-token",
        "CONFLUENCE_EMAIL": "your-email",
        "CONFLUENCE_HOST": "https://your-team.atlassian.net"
      }
    }
  }
}
```

### Credentials

Generate an API token at [Atlassian Account Settings](https://id.atlassian.com/manage/api-tokens).

## Tools

| Tool | Description |
|------|-------------|
| `manage_confluence_page` | Get, create, update, delete, move, copy, or pull pages for editing |
| `edit_confluence_content` | Structural block editing within a tracked session — patch sections, append, replace, find/replace, sync |
| `manage_confluence_space` | List spaces, get space details, or manage space configuration |
| `search_confluence` | Search using CQL, full-text, labels, or contributors |
| `manage_confluence_media` | Upload, download, list, or delete page attachments |
| `navigate_confluence` | Traverse page hierarchy, discover backlinks (via GraphQL), forward links, and related pages |
| `queue_confluence_operations` | Batch multiple operations with result references (`$0.pageId`) and error strategies |

Each tool accepts an `operation` parameter (except `queue_confluence_operations` which takes an `operations` array). Per-tool documentation is available as MCP resources at `confluence://tools/{tool_name}/documentation`.

## Key Features

**Session-based editing** — Pull a page into a tracked session, make surgical edits to individual blocks (sections, paragraphs, macros, tables), then sync only what changed. No full-page rewrites.

**Native macro support** — Status badges, info/warning/error panels, expand blocks, and table of contents render as readable `:::directive` syntax. The server handles ADF serialization with correct native node types.

**GraphQL navigation** — Backlinks and forward links use the Atlassian GraphQL gateway's link graph for accurate, fast relationship discovery. Falls back to REST when GraphQL is unavailable.

**Rendering facades** — Every response is token-efficient markdown with context-aware next-step hints. No raw JSON.

## MCP Resources

| Resource | Description |
|----------|-------------|
| `confluence://macros` | Available macro registry with parameter schemas and usage examples |

## Architecture

See [docs/architecture/INDEX.md](docs/architecture/INDEX.md) for the 8 ADRs covering the five-layer architecture, hybrid client, content model, session editing, macro handling, navigation, and rendering facades.

## License

[MIT License](LICENSE)
