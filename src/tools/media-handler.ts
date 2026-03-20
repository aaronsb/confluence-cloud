/**
 * Handler for manage_confluence_media tool.
 */

import type { ConfluenceClient } from '../client/confluence-client.js';
import { renderAttachmentList } from '../rendering/markdown-renderer.js';
import { getNextSteps } from '../rendering/next-steps.js';
import type { ToolResponse } from '../types/index.js';

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

    case 'view': {
      if (!args.attachmentId) {
        return { content: [{ type: 'text', text: 'attachmentId is required for view operation' }], isError: true };
      }
      const info = await client.getAttachmentInfo(args.attachmentId);
      if (!info.mediaType.startsWith('image/')) {
        return {
          content: [{
            type: 'text',
            text: `📎 ${info.title} | ${info.mediaType} | ${info.fileSize}B\n\nNot an image — cannot display inline. Use download to fetch raw content.`,
          }],
        };
      }
      const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
      if (info.fileSize > MAX_IMAGE_SIZE) {
        return {
          content: [{
            type: 'text',
            text: `📎 ${info.title} | ${info.mediaType} | ${info.fileSize}B\n\nImage too large to display inline (${(info.fileSize / 1024 / 1024).toFixed(1)}MB, max 5MB).`,
          }],
        };
      }
      const bytes = await client.downloadAttachment(args.attachmentId);
      return {
        content: [
          { type: 'text', text: `📎 ${info.title} | ${info.mediaType}` },
          { type: 'image', data: bytes.toString('base64'), mimeType: info.mediaType },
        ],
      };
    }

    case 'get_info': {
      if (!args.attachmentId) {
        return { content: [{ type: 'text', text: 'attachmentId is required for get_info operation' }], isError: true };
      }
      const attachInfo = await client.getAttachmentInfo(args.attachmentId);
      return {
        content: [{
          type: 'text',
          text: `📎 ${attachInfo.title} | ${attachInfo.mediaType} | ${attachInfo.fileSize}B | v${attachInfo.version}`,
        }],
      };
    }

    case 'download':
      return { content: [{ type: 'text', text: `Operation 'download' is not yet implemented.` }] };

    default:
      return { content: [{ type: 'text', text: `Unknown media operation: ${args.operation}` }], isError: true };
  }
}
