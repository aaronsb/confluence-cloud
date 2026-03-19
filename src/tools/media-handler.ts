/**
 * Handler for manage_confluence_media tool.
 */

import type { ConfluenceClient } from '../client/confluence-client.js';
import type { ToolResponse } from '../types/index.js';
import { renderAttachmentList } from '../rendering/markdown-renderer.js';
import { getNextSteps } from '../rendering/next-steps.js';

interface MediaArgs {
  operation: string;
  pageId?: string;
  attachmentId?: string;
  filename?: string;
  content?: string;
  mediaType?: string;
}

export async function handleMediaRequest(
  client: ConfluenceClient,
  args: MediaArgs,
): Promise<ToolResponse> {
  switch (args.operation) {
    case 'list': {
      if (!args.pageId) {
        return { content: [{ type: 'text', text: 'pageId is required for list operation' }], isError: true };
      }
      const result = await client.getAttachments(args.pageId);
      let text = renderAttachmentList(result.results);
      text += getNextSteps('media_list', { pageId: args.pageId });
      return { content: [{ type: 'text', text }] };
    }

    case 'upload': {
      if (!args.pageId || !args.filename || !args.content || !args.mediaType) {
        return {
          content: [{ type: 'text', text: 'pageId, filename, content (base64), and mediaType are required for upload' }],
          isError: true,
        };
      }
      const buffer = Buffer.from(args.content, 'base64');
      const attachment = await client.uploadAttachment(args.pageId, args.filename, buffer, args.mediaType);
      let text = `Uploaded: 📎 ${attachment.title} | ${attachment.mediaType} | ${attachment.fileSize}B`;
      text += getNextSteps('media_upload', { pageId: args.pageId });
      return { content: [{ type: 'text', text }] };
    }

    case 'delete': {
      if (!args.attachmentId) {
        return { content: [{ type: 'text', text: 'attachmentId is required for delete operation' }], isError: true };
      }
      await client.deleteAttachment(args.attachmentId);
      return { content: [{ type: 'text', text: `Deleted attachment ${args.attachmentId}.` }] };
    }

    case 'download':
    case 'get_info':
      return { content: [{ type: 'text', text: `Operation '${args.operation}' is not yet implemented.` }] };

    default:
      return { content: [{ type: 'text', text: `Unknown media operation: ${args.operation}` }], isError: true };
  }
}
