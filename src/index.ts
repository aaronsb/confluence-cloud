#!/usr/bin/env node

/**
 * Confluence Cloud MCP Server
 *
 * A Model Context Protocol server for interacting with Confluence Cloud.
 * See docs/architecture/ for ADRs describing the design.
 */

import { createRequire } from 'node:module';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ConfluenceRestClient } from './client/confluence-client.js';
import { discoverCloudId, GraphQLClient } from './client/graphql-client.js';
import { MacroRegistry } from './content/macro-registry.js';
import { NavigationService } from './navigation/navigation-service.js';
import { ScratchpadManager } from './sessions/scratchpad.js';
import { handleEditRequest } from './tools/edit-handler.js';
import { handleMediaRequest } from './tools/media-handler.js';
import { handleNavigateRequest } from './tools/navigate-handler.js';
import { handlePageRequest } from './tools/page-handler.js';
import { handleQueueRequest } from './tools/queue-handler.js';
import { handleSearchRequest } from './tools/search-handler.js';
import { handleSpaceRequest } from './tools/space-handler.js';
import { handleWorkspaceRequest } from './tools/workspace-handler.js';
import { toolSchemas } from './tools/tool-schemas.js';
import type { ToolResponse } from './types/index.js';

// ── Configuration ──────────────────────────────────────────────

const CONFLUENCE_EMAIL = process.env.CONFLUENCE_EMAIL;
const CONFLUENCE_API_TOKEN = process.env.CONFLUENCE_API_TOKEN;

// Normalize host: ensure https:// prefix, strip trailing slashes
const rawHost = process.env.CONFLUENCE_HOST?.trim();
const CONFLUENCE_HOST = rawHost
  ? (rawHost.startsWith('http') ? rawHost : `https://${rawHost}`).replace(/\/+$/, '')
  : undefined;

if (!CONFLUENCE_EMAIL || !CONFLUENCE_API_TOKEN || !CONFLUENCE_HOST) {
  console.error(
    'Missing required environment variables. Set:\n' +
    '  CONFLUENCE_EMAIL     - Your Atlassian account email\n' +
    '  CONFLUENCE_API_TOKEN - API token from https://id.atlassian.com/manage/api-tokens\n' +
    '  CONFLUENCE_HOST      - Your instance URL (e.g., https://your-team.atlassian.net)'
  );
  process.exit(1);
}

// ── Read version from package.json ─────────────────────────────

const require = createRequire(import.meta.url);
let version = '0.0.0';
try { version = (require('../package.json') as { version: string }).version; } catch { /* MCPB bundle — version unavailable */ }

// ── Initialize services ────────────────────────────────────────

const client = new ConfluenceRestClient({
  host: CONFLUENCE_HOST,
  email: CONFLUENCE_EMAIL,
  apiToken: CONFLUENCE_API_TOKEN,
});

const scratchpads = new ScratchpadManager();
const macroRegistry = new MacroRegistry();

// GraphQL client — initialized async, navigation falls back to REST if unavailable
const navigation = new NavigationService(client, null);
let graphqlClient: GraphQLClient | null = null;

discoverCloudId(CONFLUENCE_HOST, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN)
  .then(cloudId => {
    if (cloudId) {
      graphqlClient = new GraphQLClient(CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN, cloudId);
      navigation.setGraphQLClient(graphqlClient);
      console.error(`[confluence-cloud] GraphQL enabled (cloudId: ${cloudId})`);
    } else {
      console.error('[confluence-cloud] GraphQL unavailable — using REST-only mode');
    }
  })
  .catch(() => {
    console.error('[confluence-cloud] GraphQL discovery failed — using REST-only mode');
  });

// ── MCP Server ─────────────────────────────────────────────────

const server = new Server(
  { name: 'confluence-cloud-mcp', version: version },
  { capabilities: { tools: {}, resources: {} } },
);

// ── Tool Listing ───────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.values(toolSchemas).map(schema => ({
    name: schema.name,
    description: schema.description,
    inputSchema: schema.inputSchema,
  })),
}));

// ── Tool Dispatch ──────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
type ToolHandler = (args: any) => Promise<ToolResponse>;

const toolHandlers: Record<string, ToolHandler> = {
  manage_confluence_page: (args) => handlePageRequest(client, scratchpads, args),
  edit_confluence_content: (args) => handleEditRequest(client, scratchpads, args),
  manage_confluence_space: (args) => handleSpaceRequest(client, args),
  search_confluence: (args) => handleSearchRequest(client, args),
  manage_confluence_media: (args) => handleMediaRequest(client, args),
  navigate_confluence: (args) => handleNavigateRequest(navigation, args, graphqlClient, client),
  manage_workspace: (args) => handleWorkspaceRequest(args),
  queue_confluence_operations: (args) =>
    handleQueueRequest(
      async (toolName, toolArgs) => {
        const handler = toolHandlers[toolName];
        if (!handler) return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
        return handler(toolArgs);
      },
      args,
    ),
};
/* eslint-enable @typescript-eslint/no-explicit-any */

server.setRequestHandler(CallToolRequestSchema, async (request, _extra) => {
  const { name, arguments: args } = request.params;
  const handler = toolHandlers[name];

  if (!handler) {
    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      isError: true,
    } as Record<string, unknown>;
  }

  try {
    const result = await handler(args ?? {});
    return result as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
      isError: true,
    } as Record<string, unknown>;
  }
});

// ── Resources ──────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'confluence://macros',
      name: 'Available Macros',
      description: 'Confluence macro registry with parameter schemas and usage examples',
      mimeType: 'text/markdown',
    },
    {
      uri: 'confluence://instance/summary',
      name: 'Instance Summary',
      description: 'Confluence instance overview: available spaces, GraphQL status',
      mimeType: 'text/markdown',
    },
    {
      uri: 'confluence://tools/documentation',
      name: 'Tool Documentation',
      description: 'Complete documentation for all Confluence MCP tools with operations and examples',
      mimeType: 'text/markdown',
    },
  ],
}));

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    {
      uriTemplate: 'confluence://spaces/{key}/overview',
      name: 'Space Overview',
      description: 'Space overview with recent pages. Replace {key} with the space key.',
      mimeType: 'text/markdown',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'confluence://macros') {
    const macros = macroRegistry.all();
    const lines = [
      '# Available Confluence Macros',
      '',
      ...macros.map(m => {
        const params = m.params.map(p => {
          const req = p.required ? '(required)' : '(optional)';
          const vals = p.values ? ` — values: ${p.values.join(', ')}` : '';
          return `  - \`${p.name}\` ${req}: ${p.type}${vals}`;
        });
        return [
          `## ${m.name} (\`${m.key}\`)`,
          `Category: ${m.category} | Body: ${m.hasBody ? 'yes' : 'no'}`,
          `Syntax: \`${m.renderHint}\``,
          params.length > 0 ? `Parameters:\n${params.join('\n')}` : '',
          '',
        ].filter(Boolean).join('\n');
      }),
    ];

    return {
      contents: [{
        uri,
        mimeType: 'text/markdown',
        text: lines.join('\n'),
      }],
    };
  }

  if (uri === 'confluence://instance/summary') {
    const spacesResult = await client.listSpaces({ limit: 250 });
    const globalSpaces = spacesResult.results.filter(s => s.type === 'global');
    const personalSpaces = spacesResult.results.filter(s => s.type === 'personal');

    const lines = [
      '# Confluence Instance Summary',
      '',
      `Host: ${CONFLUENCE_HOST}`,
      `GraphQL: ${graphqlClient ? 'enabled' : 'unavailable (REST-only mode)'}`,
      '',
      `## Spaces (${spacesResult.results.length} total)`,
      '',
      `Global spaces: ${globalSpaces.length}`,
      `Personal spaces: ${personalSpaces.length}`,
      '',
      '### Global Spaces',
      '',
      ...globalSpaces.map(s => `- **${s.name}** (${s.key}) — ${s.status}`),
      '',
      '### Personal Spaces',
      '',
      ...personalSpaces.map(s => `- **${s.name}** (${s.key}) — ${s.status}`),
    ];

    return {
      contents: [{
        uri,
        mimeType: 'text/markdown',
        text: lines.join('\n'),
      }],
    };
  }

  // confluence://spaces/{key}/overview
  const spaceMatch = uri.match(/^confluence:\/\/spaces\/([^/]+)\/overview$/);
  if (spaceMatch) {
    const spaceKey = spaceMatch[1];
    // Validate space key is alphanumeric (prevent CQL injection)
    if (!/^[a-zA-Z0-9~_]+$/.test(spaceKey)) {
      return { contents: [{ uri, mimeType: 'text/plain', text: `Invalid space key: ${spaceKey}` }] };
    }
    // Find space by key via search
    const { escapeCql: esc } = await import('./client/cql-utils.js');
    const searchResult = await client.searchByCql(`type = space AND space.key = "${esc(spaceKey)}"`, { limit: 1 });
    if (searchResult.results.length === 0) {
      return { contents: [{ uri, mimeType: 'text/plain', text: `Space not found: ${spaceKey}` }] };
    }
    // Get recent pages
    const recentPages = await client.searchByCql(
      `type = page AND space = "${esc(spaceKey)}" ORDER BY lastmodified DESC`,
      { limit: 10 },
    );
    const lines = [
      `# Space: ${spaceKey}`,
      '',
      `## Recent Pages`,
      '',
      ...recentPages.results.map(r =>
        `- **${r.content.title}** | id:${r.content.id} | ${r.lastModified}`
      ),
    ];
    if (recentPages.results.length === 0) {
      lines.push('No pages found in this space.');
    }
    return { contents: [{ uri, mimeType: 'text/markdown', text: lines.join('\n') }] };
  }

  if (uri === 'confluence://tools/documentation') {
    const { renderToolDocumentation } = await import('./rendering/markdown-renderer.js');
    const docs = renderToolDocumentation(toolSchemas);
    return {
      contents: [{
        uri,
        mimeType: 'text/markdown',
        text: docs,
      }],
    };
  }

  return {
    contents: [{
      uri,
      mimeType: 'text/plain',
      text: `Unknown resource: ${uri}`,
    }],
  };
});


// ── Start Server ───────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Confluence Cloud MCP server v${version} running on stdio`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
