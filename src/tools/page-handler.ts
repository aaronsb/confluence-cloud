/**
 * Handler for manage_confluence_page tool.
 */

import type { ConfluenceClient } from '../client/confluence-client.js';
import type { SessionManager } from '../sessions/editing-session.js';
import type { ToolResponse } from '../types/index.js';
import { renderPage, renderPageList } from '../rendering/markdown-renderer.js';
import { getNextSteps } from '../rendering/next-steps.js';
import { parseAdf, resetIdCounter, type AdfNode } from '../content/adf-parser.js';
import { renderBlocks } from '../content/renderer.js';

interface PageArgs {
  operation: string;
  pageId?: string;
  spaceId?: string;
  title?: string;
  parentId?: string;
  expand?: string[];
}

export async function handlePageRequest(
  client: ConfluenceClient,
  sessions: SessionManager,
  args: PageArgs,
): Promise<ToolResponse> {
  switch (args.operation) {
    case 'get':
      return handleGet(client, args);
    case 'create':
      return handleCreate(client, args);
    case 'update':
      return handleUpdate(client, args);
    case 'delete':
      return handleDelete(client, args);
    case 'pull_for_editing':
      return handlePullForEditing(client, sessions, args);
    case 'get_versions':
      return handleGetVersions(client, args);
    default:
      return { content: [{ type: 'text', text: `Unknown operation: ${args.operation}` }], isError: true };
  }
}

async function handleGet(client: ConfluenceClient, args: PageArgs): Promise<ToolResponse> {
  if (!args.pageId) {
    return { content: [{ type: 'text', text: 'pageId is required for get operation' }], isError: true };
  }

  const page = await client.getPage(args.pageId, args.expand);
  const showBody = args.expand?.includes('body');
  let text = renderPage(page, { showBody });

  // If body expanded and ADF available, render the content model
  if (showBody && page.body?.atlas_doc_format) {
    resetIdCounter();
    const blocks = parseAdf(page.body.atlas_doc_format as unknown as AdfNode);
    text += '\n\n---\n\n' + renderBlocks(blocks);
  }

  text += getNextSteps('page_get', { pageId: args.pageId });
  return { content: [{ type: 'text', text }] };
}

async function handleCreate(client: ConfluenceClient, args: PageArgs): Promise<ToolResponse> {
  if (!args.spaceId || !args.title) {
    return { content: [{ type: 'text', text: 'spaceId and title are required for create operation' }], isError: true };
  }

  const page = await client.createPage(args.spaceId, args.title, undefined, args.parentId);
  let text = `Created page successfully.\n\n${renderPage(page)}`;
  text += getNextSteps('page_create', { pageId: page.id });
  return { content: [{ type: 'text', text }] };
}

async function handleUpdate(client: ConfluenceClient, args: PageArgs): Promise<ToolResponse> {
  if (!args.pageId) {
    return { content: [{ type: 'text', text: 'pageId is required for update operation' }], isError: true };
  }

  // Fetch current page to get version number
  const current = await client.getPage(args.pageId);
  const title = args.title ?? current.title;

  const page = await client.updatePage(
    args.pageId,
    title,
    current.body?.atlas_doc_format ?? { type: 'doc', content: [] },
    current.version.number,
  );

  let text = `Updated page successfully.\n\n${renderPage(page)}`;
  text += getNextSteps('page_update', { pageId: page.id });
  return { content: [{ type: 'text', text }] };
}

async function handleDelete(client: ConfluenceClient, args: PageArgs): Promise<ToolResponse> {
  if (!args.pageId) {
    return { content: [{ type: 'text', text: 'pageId is required for delete operation' }], isError: true };
  }

  await client.deletePage(args.pageId);
  let text = `Deleted page ${args.pageId}.`;
  text += getNextSteps('page_delete', { pageId: args.pageId });
  return { content: [{ type: 'text', text }] };
}

async function handlePullForEditing(
  client: ConfluenceClient,
  sessions: SessionManager,
  args: PageArgs,
): Promise<ToolResponse> {
  if (!args.pageId) {
    return { content: [{ type: 'text', text: 'pageId is required for pull_for_editing' }], isError: true };
  }

  const page = await client.getPage(args.pageId, ['body']);

  if (!page.body?.atlas_doc_format) {
    return { content: [{ type: 'text', text: 'Page has no ADF content body.' }], isError: true };
  }

  resetIdCounter();
  const blocks = parseAdf(page.body.atlas_doc_format as unknown as AdfNode);
  const sessionId = sessions.create(args.pageId, page.spaceKey ?? page.spaceId, page.version.number, blocks);

  const rendered = renderBlocks(blocks);
  const text = [
    `Editing session created for: ${page.title}`,
    `Session: ${sessionId}`,
    `Version: ${page.version.number}`,
    `Blocks: ${blocks.length}`,
    '',
    '---',
    '',
    rendered,
    '',
    '---',
    '**Next steps:**',
    `- Edit content: \`edit_confluence_content\` — \`{"sessionHandle": "${sessionId}", "operation": "list_blocks"}\``,
    `- Close session: \`edit_confluence_content\` — \`{"sessionHandle": "${sessionId}", "operation": "close"}\``,
  ].join('\n');

  return { content: [{ type: 'text', text }] };
}

async function handleGetVersions(client: ConfluenceClient, args: PageArgs): Promise<ToolResponse> {
  if (!args.pageId) {
    return { content: [{ type: 'text', text: 'pageId is required for get_versions' }], isError: true };
  }

  // TODO: Implement version history retrieval
  const page = await client.getPage(args.pageId);
  const text = `Current version: ${page.version.number}\n\nFull version history not yet implemented.`;
  return { content: [{ type: 'text', text }] };
}
