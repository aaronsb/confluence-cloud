#!/usr/bin/env node

/**
 * Confluence Cloud MCP Server
 *
 * A Model Context Protocol server for interacting with Confluence Cloud.
 * See docs/architecture/ for ADRs describing the design.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'node:module';

import { ConfluenceRestClient } from './client/confluence-client.js';
import { discoverCloudId, GraphQLClient } from './client/graphql-client.js';
import { SessionManager } from './sessions/editing-session.js';
import { MacroRegistry } from './content/macro-registry.js';
import { toolSchemas } from './tools/tool-schemas.js';
import { handlePageRequest } from './tools/page-handler.js';
import { handleEditRequest } from './tools/edit-handler.js';
import { handleSpaceRequest } from './tools/space-handler.js';
import { handleSearchRequest } from './tools/search-handler.js';
import { handleMediaRequest } from './tools/media-handler.js';
import { handleNavigateRequest } from './tools/navigate-handler.js';
import { handleQueueRequest } from './tools/queue-handler.js';
import { NavigationService } from './navigation/navigation-service.js';
import type { ToolResponse } from './types/index.js';

// ── Configuration ──────────────────────────────────────────────

const CONFLUENCE_EMAIL = process.env.CONFLUENCE_EMAIL;
const CONFLUENCE_API_TOKEN = process.env.CONFLUENCE_API_TOKEN;
const CONFLUENCE_HOST = process.env.CONFLUENCE_HOST;

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
const pkg = require('../package.json') as { version: string };

// ── Initialize services ────────────────────────────────────────

const client = new ConfluenceRestClient({
  host: CONFLUENCE_HOST,
  email: CONFLUENCE_EMAIL,
  apiToken: CONFLUENCE_API_TOKEN,
});

const sessions = new SessionManager();
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
  { name: 'confluence-cloud-mcp', version: pkg.version },
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
  manage_confluence_page: (args) => handlePageRequest(client, sessions, args),
  edit_confluence_content: (args) => handleEditRequest(client, sessions, args),
  manage_confluence_space: (args) => handleSpaceRequest(client, args),
  search_confluence: (args) => handleSearchRequest(client, args),
  manage_confluence_media: (args) => handleMediaRequest(client, args),
  navigate_confluence: (args) => handleNavigateRequest(navigation, args, graphqlClient, client),
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

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
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
  console.error(`Confluence Cloud MCP server v${pkg.version} running on stdio`);
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
