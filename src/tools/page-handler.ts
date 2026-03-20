/**
 * Handler for manage_confluence_page tool.
 */

import type { ConfluenceClient } from '../client/confluence-client.js';
import { parseAdf, type AdfNode } from '../content/adf-parser.js';
import { renderBlocks, renderBlocksForScratchpad } from '../content/renderer.js';
import { renderPage } from '../rendering/markdown-renderer.js';
import { getNextSteps } from '../rendering/next-steps.js';
import type { ScratchpadManager } from '../sessions/scratchpad.js';
import type { ToolResponse } from '../types/index.js';

interface PageArgs {
  operation: string;
  pageId?: string;
  spaceId?: string;
  title?: string;
  parentId?: string;
  expand?: string[];
  labels?: string[];
  label?: string;
  propertyKey?: string;
  propertyValue?: Record<string, unknown>;
}

export async function handlePageRequest(
  client: ConfluenceClient,
  scratchpads: ScratchpadManager,
  args: PageArgs,
): Promise<ToolResponse> {
  switch (args.operation) {
    case 'get':
      return handleGet(client, args);
    case 'create':
      return handleCreate(scratchpads, args);
    case 'update':
      return handleUpdate(client, args);
    case 'delete':
      return handleDelete(client, args);
    case 'pull_for_editing':
      return handlePullForEditing(client, scratchpads, args);
    case 'move':
    case 'copy':
      return { content: [{ type: 'text', text: `Operation '${args.operation}' is not yet implemented.` }] };
    case 'get_versions':
      return handleGetVersions(client, args);
    case 'get_labels':
      return handleGetLabels(client, args);
    case 'add_labels':
      return handleAddLabels(client, args);
    case 'remove_label':
      return handleRemoveLabel(client, args);
    case 'get_properties':
      return handleGetProperties(client, args);
    case 'get_property':
      return handleGetProperty(client, args);
    case 'set_property':
      return handleSetProperty(client, args);
    case 'delete_property':
      return handleDeleteProperty(client, args);
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
    const blocks = parseAdf(page.body.atlas_doc_format as AdfNode);
    text += '\n\n---\n\n' + renderBlocks(blocks);
  }

  text += getNextSteps('page_get', { pageId: args.pageId });
  return { content: [{ type: 'text', text }] };
}

function handleCreate(scratchpads: ScratchpadManager, args: PageArgs): ToolResponse {
  if (!args.spaceId || !args.title) {
    return { content: [{ type: 'text', text: 'spaceId and title are required for create operation' }], isError: true };
  }

  const scratchpadId = scratchpads.createEmpty({
    type: 'new_page',
    spaceId: args.spaceId,
    title: args.title,
    parentId: args.parentId,
  });

  const text = [
    `Page prepared: "${args.title}"`,
    `Scratchpad: ${scratchpadId}`,
    '',
    'Edit the scratchpad, then submit to create the page on Confluence.',
    '',
    '**Next steps:**',
    `- Add content: \`edit_confluence_content\` — \`{"operation": "append_lines", "scratchpadId": "${scratchpadId}", "content": "..."}\``,
    `- View buffer: \`edit_confluence_content\` — \`{"operation": "view", "scratchpadId": "${scratchpadId}"}\``,
    `- Publish: \`edit_confluence_content\` — \`{"operation": "submit", "scratchpadId": "${scratchpadId}"}\``,
  ].join('\n');

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
  scratchpads: ScratchpadManager,
  args: PageArgs,
): Promise<ToolResponse> {
  if (!args.pageId) {
    return { content: [{ type: 'text', text: 'pageId is required for pull_for_editing' }], isError: true };
  }

  const page = await client.getPage(args.pageId, ['body']);

  if (!page.body?.atlas_doc_format) {
    return { content: [{ type: 'text', text: 'Page has no ADF content body.' }], isError: true };
  }

  const blocks = parseAdf(page.body.atlas_doc_format as AdfNode);
  const { text: rendered, sideTable } = renderBlocksForScratchpad(blocks);
  const lines = rendered.split('\n');

  const scratchpadId = scratchpads.createFromLines(
    {
      type: 'existing_page',
      pageId: args.pageId,
      version: page.version.number,
      title: page.title,
    },
    lines,
    sideTable,
  );

  const view = scratchpads.view(scratchpadId);

  return { content: [{ type: 'text', text: view! }] };
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

// ── Labels ──────────────────────────────────────────────────

async function handleGetLabels(client: ConfluenceClient, args: PageArgs): Promise<ToolResponse> {
  if (!args.pageId) {
    return { content: [{ type: 'text', text: 'pageId is required for get_labels' }], isError: true };
  }
  const labels = await client.getLabels(args.pageId);
  const text = labels.length > 0
    ? `Labels on page ${args.pageId}: ${labels.join(', ')}`
    : `No labels on page ${args.pageId}.`;
  return { content: [{ type: 'text', text: text + getNextSteps('page_get', { pageId: args.pageId }) }] };
}

async function handleAddLabels(client: ConfluenceClient, args: PageArgs): Promise<ToolResponse> {
  if (!args.pageId) {
    return { content: [{ type: 'text', text: 'pageId is required for add_labels' }], isError: true };
  }
  if (!args.labels || args.labels.length === 0) {
    return { content: [{ type: 'text', text: 'labels array is required for add_labels' }], isError: true };
  }
  await client.addLabels(args.pageId, args.labels);
  const text = `Added ${args.labels.length} label(s) to page ${args.pageId}: ${args.labels.join(', ')}`;
  return { content: [{ type: 'text', text: text + getNextSteps('page_update', { pageId: args.pageId }) }] };
}

async function handleRemoveLabel(client: ConfluenceClient, args: PageArgs): Promise<ToolResponse> {
  if (!args.pageId) {
    return { content: [{ type: 'text', text: 'pageId is required for remove_label' }], isError: true };
  }
  if (!args.label) {
    return { content: [{ type: 'text', text: 'label is required for remove_label' }], isError: true };
  }
  await client.removeLabel(args.pageId, args.label);
  const text = `Removed label "${args.label}" from page ${args.pageId}.`;
  return { content: [{ type: 'text', text: text + getNextSteps('page_update', { pageId: args.pageId }) }] };
}

// ── Content Properties ──────────────────────────────────────

async function handleGetProperties(client: ConfluenceClient, args: PageArgs): Promise<ToolResponse> {
  if (!args.pageId) {
    return { content: [{ type: 'text', text: 'pageId is required for get_properties' }], isError: true };
  }
  const props = await client.getProperties(args.pageId);
  if (props.length === 0) {
    return { content: [{ type: 'text', text: `No content properties on page ${args.pageId}.` }] };
  }
  const lines = [
    `Content properties on page ${args.pageId}:`,
    '',
    '| Key | Value | Version |',
    '|-----|-------|---------|',
    ...props.map(p => `| ${p.key} | ${JSON.stringify(p.value)} | v${p.version.number} |`),
  ];
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function handleGetProperty(client: ConfluenceClient, args: PageArgs): Promise<ToolResponse> {
  if (!args.pageId) {
    return { content: [{ type: 'text', text: 'pageId is required for get_property' }], isError: true };
  }
  if (!args.propertyKey) {
    return { content: [{ type: 'text', text: 'propertyKey is required for get_property' }], isError: true };
  }
  const prop = await client.getProperty(args.pageId, args.propertyKey);
  const text = `Property "${prop.key}" on page ${args.pageId}:\n\n\`\`\`json\n${JSON.stringify(prop.value, null, 2)}\n\`\`\`\n\nVersion: ${prop.version.number}`;
  return { content: [{ type: 'text', text }] };
}

async function handleSetProperty(client: ConfluenceClient, args: PageArgs): Promise<ToolResponse> {
  if (!args.pageId) {
    return { content: [{ type: 'text', text: 'pageId is required for set_property' }], isError: true };
  }
  if (!args.propertyKey) {
    return { content: [{ type: 'text', text: 'propertyKey is required for set_property' }], isError: true };
  }
  if (!args.propertyValue || typeof args.propertyValue !== 'object') {
    return { content: [{ type: 'text', text: 'propertyValue (object) is required for set_property' }], isError: true };
  }
  const prop = await client.setProperty(args.pageId, args.propertyKey, args.propertyValue);
  const text = `Set property "${prop.key}" on page ${args.pageId} (v${prop.version.number}).\n\n\`\`\`json\n${JSON.stringify(prop.value, null, 2)}\n\`\`\``;
  return { content: [{ type: 'text', text }] };
}

async function handleDeleteProperty(client: ConfluenceClient, args: PageArgs): Promise<ToolResponse> {
  if (!args.pageId) {
    return { content: [{ type: 'text', text: 'pageId is required for delete_property' }], isError: true };
  }
  if (!args.propertyKey) {
    return { content: [{ type: 'text', text: 'propertyKey is required for delete_property' }], isError: true };
  }
  await client.deleteProperty(args.pageId, args.propertyKey);
  return { content: [{ type: 'text', text: `Deleted property "${args.propertyKey}" from page ${args.pageId}.` }] };
}
