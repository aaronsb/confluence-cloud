/**
 * Handler for edit_confluence_content tool.
 */

import type { ConfluenceClient } from '../client/confluence-client.js';
import type { SessionManager } from '../sessions/editing-session.js';
import type { ToolResponse } from '../types/index.js';
import { renderBlocks } from '../content/renderer.js';
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
    case 'list_blocks': {
      const blocks = sessions.getCurrentBlocks(args.sessionHandle);
      const rendered = renderBlocks(blocks);
      const blockSummary = session.blocks
        .filter(b => b.state !== 'deleted')
        .map((b, i) => `  [${i}] ${b.id} (${b.block.type}) ${b.state !== 'unchanged' ? `[${b.state}]` : ''}`)
        .join('\n');

      return {
        content: [{
          type: 'text',
          text: `Session: ${session.sessionId} | Page: ${session.pageId} | Status: ${session.status}\n\nBlocks:\n${blockSummary}\n\n---\n\n${rendered}`,
        }],
      };
    }

    case 'sync': {
      // Reconstruct full page from current blocks and update via API
      const blocks = sessions.getCurrentBlocks(args.sessionHandle);
      const changes = sessions.getChanges(args.sessionHandle);

      if (changes.length === 0) {
        return { content: [{ type: 'text', text: 'No changes to sync.' }] };
      }

      // TODO: Serialize blocks back to ADF and call client.updatePage
      // For now, report what would be synced
      const changeSummary = changes.map(c => `  ${c.id}: ${c.state}`).join('\n');
      let text = `Would sync ${changes.length} change(s):\n${changeSummary}\n\nADF serialization not yet implemented.`;
      text += getNextSteps('edit_sync', { pageId: session.pageId });
      return { content: [{ type: 'text', text }] };
    }

    case 'close': {
      const changes = sessions.getChanges(args.sessionHandle);
      sessions.close(args.sessionHandle);
      const text = changes.length > 0
        ? `Session closed. Warning: ${changes.length} unsaved change(s) were discarded.`
        : 'Session closed.';
      return { content: [{ type: 'text', text }] };
    }

    case 'patch_section':
    case 'patch_block':
    case 'append':
    case 'replace':
    case 'window_edit':
      // TODO: Implement structural editing operations
      return {
        content: [{
          type: 'text',
          text: `Operation '${args.operation}' is not yet implemented. Session state preserved.`,
        }],
      };

    default:
      return { content: [{ type: 'text', text: `Unknown edit operation: ${args.operation}` }], isError: true };
  }
}
