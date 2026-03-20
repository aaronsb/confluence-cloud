/**
 * Handler for edit_confluence_content tool.
 * See ADR-304: Scratchpad Buffer — Line-Addressed Content Authoring.
 */

import type { ConfluenceClient } from '../client/confluence-client.js';
import { serializeBlocks } from '../content/adf-serializer.js';
import type { Block } from '../content/blocks.js';
import { parseDirectives } from '../content/directive-parser.js';
import { getNextSteps } from '../rendering/next-steps.js';
import type { ScratchpadManager } from '../sessions/scratchpad.js';
import type { ToolResponse } from '../types/index.js';

interface EditArgs {
  operation: string;
  scratchpadId?: string;
  afterLine?: number;
  startLine?: number;
  endLine?: number;
  content?: string;
  message?: string;
}

export async function handleEditRequest(
  client: ConfluenceClient,
  scratchpads: ScratchpadManager,
  args: EditArgs,
): Promise<ToolResponse> {
  // List doesn't require a scratchpadId
  if (args.operation === 'list') {
    return handleList(scratchpads);
  }

  if (!args.scratchpadId) {
    return {
      content: [{ type: 'text', text: 'scratchpadId is required. Use manage_confluence_page create or pull_for_editing to get one.' }],
      isError: true,
    };
  }

  const sp = scratchpads.get(args.scratchpadId);
  if (!sp) {
    return {
      content: [{ type: 'text', text: 'Scratchpad not found or expired. Use manage_confluence_page create or pull_for_editing to start a new one.' }],
      isError: true,
    };
  }

  switch (args.operation) {
    case 'view':
      return handleView(scratchpads, args);

    case 'insert_lines':
      return handleInsertLines(scratchpads, args);

    case 'append_lines':
      return handleAppendLines(scratchpads, args);

    case 'replace_lines':
      return handleReplaceLines(scratchpads, args);

    case 'remove_lines':
      return handleRemoveLines(scratchpads, args);

    case 'submit':
      return handleSubmit(client, scratchpads, args);

    case 'discard':
      return handleDiscard(scratchpads, args);

    default:
      return { content: [{ type: 'text', text: `Unknown operation: ${args.operation}` }], isError: true };
  }
}

// ── View ───────────────────────────────────────────────────

function handleView(scratchpads: ScratchpadManager, args: EditArgs): ToolResponse {
  const result = scratchpads.view(args.scratchpadId!, args.startLine, args.endLine);
  if (!result) {
    return { content: [{ type: 'text', text: 'Scratchpad not found.' }], isError: true };
  }
  return { content: [{ type: 'text', text: result }] };
}

// ── Insert Lines ───────────────────────────────────────────

function handleInsertLines(scratchpads: ScratchpadManager, args: EditArgs): ToolResponse {
  if (args.afterLine === undefined) {
    return { content: [{ type: 'text', text: 'afterLine is required for insert_lines.' }], isError: true };
  }
  if (args.content === undefined) {
    return { content: [{ type: 'text', text: 'content is required for insert_lines.' }], isError: true };
  }

  const result = scratchpads.insertLines(args.scratchpadId!, args.afterLine, args.content);
  if (!result) {
    return { content: [{ type: 'text', text: 'Scratchpad not found.' }], isError: true };
  }

  return { content: [{ type: 'text', text: formatMutationResponse(result) }] };
}

// ── Append Lines ───────────────────────────────────────────

function handleAppendLines(scratchpads: ScratchpadManager, args: EditArgs): ToolResponse {
  if (args.content === undefined) {
    return { content: [{ type: 'text', text: 'content is required for append_lines.' }], isError: true };
  }

  const result = scratchpads.appendLines(args.scratchpadId!, args.content);
  if (!result) {
    return { content: [{ type: 'text', text: 'Scratchpad not found.' }], isError: true };
  }

  return { content: [{ type: 'text', text: formatMutationResponse(result) }] };
}

// ── Replace Lines ──────────────────────────────────────────

function handleReplaceLines(scratchpads: ScratchpadManager, args: EditArgs): ToolResponse {
  if (args.startLine === undefined || args.endLine === undefined) {
    return { content: [{ type: 'text', text: 'startLine and endLine are required for replace_lines.' }], isError: true };
  }
  if (args.content === undefined) {
    return { content: [{ type: 'text', text: 'content is required for replace_lines.' }], isError: true };
  }

  const result = scratchpads.replaceLines(args.scratchpadId!, args.startLine, args.endLine, args.content);
  if (!result) {
    return { content: [{ type: 'text', text: 'Scratchpad not found.' }], isError: true };
  }

  return { content: [{ type: 'text', text: formatMutationResponse(result) }] };
}

// ── Remove Lines ───────────────────────────────────────────

function handleRemoveLines(scratchpads: ScratchpadManager, args: EditArgs): ToolResponse {
  if (args.startLine === undefined) {
    return { content: [{ type: 'text', text: 'startLine is required for remove_lines.' }], isError: true };
  }

  const result = scratchpads.removeLines(args.scratchpadId!, args.startLine, args.endLine);
  if (!result) {
    return { content: [{ type: 'text', text: 'Scratchpad not found.' }], isError: true };
  }

  return { content: [{ type: 'text', text: formatMutationResponse(result) }] };
}

// ── Submit ─────────────────────────────────────────────────

async function handleSubmit(
  client: ConfluenceClient,
  scratchpads: ScratchpadManager,
  args: EditArgs,
): Promise<ToolResponse> {
  const sp = scratchpads.get(args.scratchpadId!)!;
  const content = scratchpads.getContent(args.scratchpadId!)!;

  if (content.trim() === '') {
    return { content: [{ type: 'text', text: 'Cannot submit empty scratchpad. Add content first.' }], isError: true };
  }

  // Parse content to blocks
  let blocks: Block[];
  try {
    blocks = parseDirectives(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Submit failed: parse error — ${message}\nScratchpad ${args.scratchpadId} is still active.` }],
      isError: true,
    };
  }

  if (blocks.length === 0) {
    return {
      content: [{ type: 'text', text: `Submit failed: content produced no parseable blocks.\nScratchpad ${args.scratchpadId} is still active.` }],
      isError: true,
    };
  }

  // Resolve RawAdfBlock placeholders from side-table
  const sideTable = scratchpads.getRawAdfSideTable(args.scratchpadId!)!;
  resolveRawAdfPlaceholders(blocks, sideTable);

  // Serialize to ADF
  const adf = serializeBlocks(blocks);

  // Push to Confluence
  try {
    if (sp.target.type === 'new_page') {
      const page = await client.createPage(
        sp.target.spaceId,
        sp.target.title,
        adf,
        sp.target.parentId,
      );
      scratchpads.discard(args.scratchpadId!);

      let text = `Page created successfully.\n\nPage ID: ${page.id}\nTitle: ${page.title}\nVersion: ${page.version.number}`;
      text += getNextSteps('page_create', { pageId: page.id });
      return { content: [{ type: 'text', text }] };
    } else {
      const page = await client.updatePage(
        sp.target.pageId,
        sp.target.title,
        adf,
        sp.target.version,
        args.message,
      );
      scratchpads.discard(args.scratchpadId!);

      let text = `Page updated successfully.\n\nPage ID: ${page.id}\nTitle: ${page.title}\nVersion: ${page.version.number}`;
      text += getNextSteps('page_update', { pageId: page.id });
      return { content: [{ type: 'text', text }] };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('409') || message.includes('version')) {
      return {
        content: [{
          type: 'text',
          text: `Submit failed: Version conflict — page was modified since pull.\nScratchpad ${args.scratchpadId} is still active.\nOptions: discard and re-pull to get latest, or try again.`,
        }],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text', text: `Submit failed: ${message}\nScratchpad ${args.scratchpadId} is still active.` }],
      isError: true,
    };
  }
}

// ── Discard ────────────────────────────────────────────────

function handleDiscard(scratchpads: ScratchpadManager, args: EditArgs): ToolResponse {
  scratchpads.discard(args.scratchpadId!);
  return { content: [{ type: 'text', text: `Scratchpad ${args.scratchpadId} discarded.` }] };
}

// ── List ───────────────────────────────────────────────────

function handleList(scratchpads: ScratchpadManager): ToolResponse {
  const list = scratchpads.list();

  if (list.length === 0) {
    return { content: [{ type: 'text', text: 'No active scratchpads.' }] };
  }

  const lines = list.map(sp => {
    const target = sp.target.type === 'new_page'
      ? `New page: "${sp.target.title}"`
      : `Page ${sp.target.pageId}: "${sp.target.title}"`;
    return `- ${sp.id} | ${target} | ${sp.lineCount} lines | ${sp.validation}`;
  });

  return { content: [{ type: 'text', text: `Active scratchpads:\n${lines.join('\n')}` }] };
}

// ── Helpers ────────────────────────────────────────────────

function formatMutationResponse(result: { message: string; context: string; validation: string }): string {
  const parts = [result.message];
  if (result.context) parts.push(result.context);
  parts.push(result.validation);
  return parts.join('\n');
}

/**
 * Walk block tree and resolve RawAdfBlock placeholders from the side-table.
 */
function resolveRawAdfPlaceholders(blocks: Block[], sideTable: Map<string, object>): void {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === 'raw_adf' && block.hash) {
      const stored = sideTable.get(block.hash);
      if (stored) {
        block.adf = stored;
      }
    }
    // Recurse into sections
    if (block.type === 'section') {
      resolveRawAdfPlaceholders(block.content, sideTable);
    }
    // Recurse into macro bodies
    if (block.type === 'macro' && block.body) {
      resolveRawAdfPlaceholders(block.body, sideTable);
    }
  }
}
