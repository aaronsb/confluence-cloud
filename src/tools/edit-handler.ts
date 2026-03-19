/**
 * Handler for edit_confluence_content tool.
 * See ADR-301: Session-Based Editing with Delta Sync.
 */

import type { ConfluenceClient } from '../client/confluence-client.js';
import type { SessionManager } from '../sessions/editing-session.js';
import type { ToolResponse } from '../types/index.js';
import type { Block } from '../content/blocks.js';
import { renderBlocks } from '../content/renderer.js';
import { serializeBlocks } from '../content/adf-serializer.js';
import { parseDirectives } from '../content/directive-parser.js';
import { getNextSteps } from '../rendering/next-steps.js';

interface EditArgs {
  operation: string;
  sessionHandle: string;
  blockId?: string;
  section?: string;
  content?: string;
  position?: number;
  searchText?: string;
  replaceText?: string;
  message?: string;
}

export async function handleEditRequest(
  client: ConfluenceClient,
  sessions: SessionManager,
  args: EditArgs,
): Promise<ToolResponse> {
  const session = sessions.get(args.sessionHandle);
  if (!session) {
    return {
      content: [{ type: 'text', text: 'Session not found or expired. Use pull_for_editing to start a new session.' }],
      isError: true,
    };
  }

  switch (args.operation) {
    case 'list_blocks':
      return handleListBlocks(sessions, args.sessionHandle, session);

    case 'patch_section':
      return handlePatchSection(sessions, args);

    case 'patch_block':
      return handlePatchBlock(sessions, args);

    case 'append':
      return handleAppend(sessions, args);

    case 'replace':
      return handleReplace(sessions, args);

    case 'window_edit':
      return handleWindowEdit(sessions, args);

    case 'sync':
      return handleSync(client, sessions, args);

    case 'close':
      return handleClose(sessions, args);

    default:
      return { content: [{ type: 'text', text: `Unknown edit operation: ${args.operation}` }], isError: true };
  }
}

// ── List Blocks ────────────────────────────────────────────────

function handleListBlocks(
  sessions: SessionManager,
  sessionHandle: string,
  session: { sessionId: string; pageId: string; status: string; blocks: Array<{ id: string; block: Block; state: string }> },
): ToolResponse {
  const blocks = sessions.getCurrentBlocks(sessionHandle);
  const rendered = renderBlocks(blocks);
  const blockSummary = session.blocks
    .filter(b => b.state !== 'deleted')
    .map((b, i) => `  [${i}] ${b.id} (${b.block.type}) ${b.state !== 'unchanged' ? `[${b.state}]` : ''}`.trimEnd())
    .join('\n');

  return {
    content: [{
      type: 'text',
      text: `Session: ${session.sessionId} | Page: ${session.pageId} | Status: ${session.status}\n\nBlocks:\n${blockSummary}\n\n---\n\n${rendered}`,
    }],
  };
}

// ── Patch Section ──────────────────────────────────────────────

function handlePatchSection(sessions: SessionManager, args: EditArgs): ToolResponse {
  if (!args.section) {
    return { content: [{ type: 'text', text: 'section heading is required for patch_section' }], isError: true };
  }
  if (!args.content) {
    return { content: [{ type: 'text', text: 'content is required for patch_section' }], isError: true };
  }

  const session = sessions.get(args.sessionHandle)!;
  const sectionBlock = session.blocks.find(
    b => b.block.type === 'section' && b.block.heading.toLowerCase() === args.section!.toLowerCase()
  );

  if (!sectionBlock) {
    return { content: [{ type: 'text', text: `Section '${args.section}' not found.` }], isError: true };
  }

  const newContent = parseDirectives(args.content);
  const updatedSection: Block = {
    ...sectionBlock.block,
    type: 'section',
    content: newContent,
  } as Block;

  sessions.updateBlock(args.sessionHandle, sectionBlock.id, updatedSection);

  return {
    content: [{
      type: 'text',
      text: `Updated section '${args.section}' with ${newContent.length} block(s).\n\n${renderBlocks([updatedSection])}`,
    }],
  };
}

// ── Patch Block ────────────────────────────────────────────────

function handlePatchBlock(sessions: SessionManager, args: EditArgs): ToolResponse {
  if (!args.blockId) {
    return { content: [{ type: 'text', text: 'blockId is required for patch_block' }], isError: true };
  }
  if (!args.content) {
    return { content: [{ type: 'text', text: 'content is required for patch_block' }], isError: true };
  }

  const parsed = parseDirectives(args.content);
  if (parsed.length === 0) {
    return { content: [{ type: 'text', text: 'content parsed to zero blocks.' }], isError: true };
  }

  const newBlock = parsed[0];
  const success = sessions.updateBlock(args.sessionHandle, args.blockId, newBlock);

  if (!success) {
    return { content: [{ type: 'text', text: `Block '${args.blockId}' not found.` }], isError: true };
  }

  return {
    content: [{
      type: 'text',
      text: `Updated block ${args.blockId}.\n\n${renderBlocks([newBlock])}`,
    }],
  };
}

// ── Append ─────────────────────────────────────────────────────

function handleAppend(sessions: SessionManager, args: EditArgs): ToolResponse {
  if (!args.content) {
    return { content: [{ type: 'text', text: 'content is required for append' }], isError: true };
  }

  const newBlocks = parseDirectives(args.content);
  const session = sessions.get(args.sessionHandle)!;
  const position = args.position ?? session.blocks.length;

  const insertedIds: string[] = [];
  for (let i = 0; i < newBlocks.length; i++) {
    const id = sessions.insertBlock(args.sessionHandle, position + i, newBlocks[i]);
    if (id) insertedIds.push(id);
  }

  return {
    content: [{
      type: 'text',
      text: `Appended ${insertedIds.length} block(s) at position ${position}.\n\n${renderBlocks(newBlocks)}`,
    }],
  };
}

// ── Replace ────────────────────────────────────────────────────

function handleReplace(sessions: SessionManager, args: EditArgs): ToolResponse {
  if (!args.blockId) {
    return { content: [{ type: 'text', text: 'blockId is required for replace' }], isError: true };
  }
  if (!args.content) {
    return { content: [{ type: 'text', text: 'content is required for replace' }], isError: true };
  }

  // Delete the old block, insert new ones at the same position
  const session = sessions.get(args.sessionHandle)!;
  const idx = session.blocks.findIndex(b => b.id === args.blockId);
  if (idx === -1) {
    return { content: [{ type: 'text', text: `Block '${args.blockId}' not found.` }], isError: true };
  }

  sessions.deleteBlock(args.sessionHandle, args.blockId);
  const newBlocks = parseDirectives(args.content);
  for (let i = 0; i < newBlocks.length; i++) {
    sessions.insertBlock(args.sessionHandle, idx + i, newBlocks[i]);
  }

  return {
    content: [{
      type: 'text',
      text: `Replaced block ${args.blockId} with ${newBlocks.length} block(s).\n\n${renderBlocks(newBlocks)}`,
    }],
  };
}

// ── Window Edit ────────────────────────────────────────────────

function handleWindowEdit(sessions: SessionManager, args: EditArgs): ToolResponse {
  if (!args.searchText) {
    return { content: [{ type: 'text', text: 'searchText is required for window_edit' }], isError: true };
  }
  if (args.replaceText === undefined) {
    return { content: [{ type: 'text', text: 'replaceText is required for window_edit' }], isError: true };
  }

  const session = sessions.get(args.sessionHandle)!;
  let found = false;

  for (const sb of session.blocks) {
    if (sb.state === 'deleted') continue;

    if (sb.block.type === 'paragraph' && sb.block.text.includes(args.searchText)) {
      const updated: Block = {
        ...sb.block,
        text: sb.block.text.replace(args.searchText, args.replaceText),
      };
      sessions.updateBlock(args.sessionHandle, sb.id, updated);
      found = true;
      break;
    }

    if (sb.block.type === 'code' && sb.block.code.includes(args.searchText)) {
      const updated: Block = {
        ...sb.block,
        code: sb.block.code.replace(args.searchText, args.replaceText),
      };
      sessions.updateBlock(args.sessionHandle, sb.id, updated);
      found = true;
      break;
    }

    // Search within sections
    if (sb.block.type === 'section') {
      const sectionUpdated = windowEditInSection(sb.block, args.searchText, args.replaceText);
      if (sectionUpdated) {
        sessions.updateBlock(args.sessionHandle, sb.id, sectionUpdated);
        found = true;
        break;
      }
    }
  }

  if (!found) {
    return { content: [{ type: 'text', text: `Text '${args.searchText}' not found in any block.` }], isError: true };
  }

  return {
    content: [{
      type: 'text',
      text: `Replaced '${args.searchText}' with '${args.replaceText}'.`,
    }],
  };
}

function windowEditInSection(section: Block & { type: 'section' }, search: string, replace: string): Block | null {
  for (let i = 0; i < section.content.length; i++) {
    const block = section.content[i];
    if (block.type === 'paragraph' && block.text.includes(search)) {
      const newContent = [...section.content];
      newContent[i] = { ...block, text: block.text.replace(search, replace) };
      return { ...section, content: newContent };
    }
    if (block.type === 'code' && block.code.includes(search)) {
      const newContent = [...section.content];
      newContent[i] = { ...block, code: block.code.replace(search, replace) };
      return { ...section, content: newContent };
    }
  }
  return null;
}

// ── Sync ───────────────────────────────────────────────────────

async function handleSync(
  client: ConfluenceClient,
  sessions: SessionManager,
  args: EditArgs,
): Promise<ToolResponse> {
  const session = sessions.get(args.sessionHandle)!;
  const changes = sessions.getChanges(args.sessionHandle);

  if (changes.length === 0) {
    return { content: [{ type: 'text', text: 'No changes to sync.' }] };
  }

  // Serialize all current (non-deleted) blocks to ADF
  const currentBlocks = sessions.getCurrentBlocks(args.sessionHandle);
  const adf = serializeBlocks(currentBlocks);

  try {
    const page = await client.updatePage(
      session.pageId,
      undefined, // keep existing title
      adf,
      session.version,
      args.message,
    );

    sessions.markSynced(args.sessionHandle, page.version.number);

    const changeSummary = changes.map(c => `  ${c.id}: ${c.state}`).join('\n');
    let text = `Synced ${changes.length} change(s) to Confluence.\n${changeSummary}\nNew version: ${page.version.number}`;
    text += getNextSteps('edit_sync', { pageId: session.pageId });
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('409') || message.includes('version')) {
      return {
        content: [{
          type: 'text',
          text: `Version conflict: page was modified since you pulled it (version ${session.version}).\nOptions:\n- Re-pull with pull_for_editing to get latest\n- Force sync (not yet implemented)\n\nError: ${message}`,
        }],
        isError: true,
      };
    }
    return { content: [{ type: 'text', text: `Sync failed: ${message}` }], isError: true };
  }
}

// ── Close ──────────────────────────────────────────────────────

function handleClose(sessions: SessionManager, args: EditArgs): ToolResponse {
  const changes = sessions.getChanges(args.sessionHandle);
  sessions.close(args.sessionHandle);
  const text = changes.length > 0
    ? `Session closed. Warning: ${changes.length} unsaved change(s) were discarded.`
    : 'Session closed.';
  return { content: [{ type: 'text', text }] };
}
