/**
 * Handler for manage_confluence_media tool.
 */

import * as fs from 'node:fs/promises';

import type { ConfluenceClient } from '../client/confluence-client.js';
import { renderAttachmentList } from '../rendering/markdown-renderer.js';
import { getNextSteps } from '../rendering/next-steps.js';
import type { ToolResponse } from '../types/index.js';
import {
  ensureWorkspaceDir,
  resolveWorkspacePath,
  ensureParentDir,
  verifyPathSafety,
  sanitizeFilename,
} from '../workspace/index.js';

interface MediaArgs {
  operation: string;
  pageId?: string;
  attachmentId?: string;
  filename?: string;
  content?: string;
  mediaType?: string;
  workspaceFile?: string;
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
      if (!args.pageId || !args.filename || !args.mediaType) {
        return {
          content: [{ type: 'text', text: 'pageId, filename, and mediaType are required for upload' }],
          isError: true,
        };
      }

      let buffer: Buffer;
      if (args.workspaceFile) {
        const filePath = resolveWorkspacePath(args.workspaceFile);
        await verifyPathSafety(filePath);
        try {
          buffer = await fs.readFile(filePath);
        } catch {
          return { content: [{ type: 'text', text: `Workspace file not found: ${args.workspaceFile}` }], isError: true };
        }
      } else if (args.content) {
        buffer = Buffer.from(args.content, 'base64');
      } else {
        return {
          content: [{ type: 'text', text: 'Either content (base64) or workspaceFile is required for upload' }],
          isError: true,
        };
      }

      const attachment = await client.uploadAttachment(args.pageId, args.filename, buffer, args.mediaType);
      let text = `Uploaded: ${attachment.title} | ${attachment.mediaType} | ${attachment.fileSize}B`;
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

    case 'download': {
      if (!args.attachmentId) {
        return { content: [{ type: 'text', text: 'attachmentId is required for download operation' }], isError: true };
      }
      const dlInfo = await client.getAttachmentInfo(args.attachmentId);
      const dlBytes = await client.downloadAttachment(args.attachmentId);

      const status = await ensureWorkspaceDir();
      if (!status.valid) {
        return { content: [{ type: 'text', text: `Workspace invalid: ${status.warning}` }], isError: true };
      }

      const dlFilename = args.filename || sanitizeFilename(dlInfo.title);
      const dlPath = resolveWorkspacePath(dlFilename);
      await verifyPathSafety(dlPath);
      await ensureParentDir(dlPath);
      await fs.writeFile(dlPath, dlBytes);

      return {
        content: [{
          type: 'text',
          text: `Downloaded: ${dlFilename} | ${dlInfo.mediaType} | ${dlBytes.length}B\nPath: ${dlPath}\n\nUse manage_workspace read or manage_confluence_media upload with workspaceFile:"${dlFilename}" to use it.`,
        }],
      };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown media operation: ${args.operation}` }], isError: true };
  }
}
