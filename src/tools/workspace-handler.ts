/**
 * Handler for manage_workspace tool.
 * See ADR-502: Workspace Directory — XDG File Staging for Attachments.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  ensureWorkspaceDir,
  resolveWorkspacePath,
  verifyPathSafety,
} from '../workspace/index.js';
import type { ToolResponse } from '../types/index.js';

interface WorkspaceArgs {
  operation: string;
  filename?: string;
  content?: string;
}

const TEXT_INLINE_LIMIT = 100 * 1024; // 100KB

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.xml', '.csv', '.html', '.htm',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.log',
  '.js', '.ts', '.py', '.rb', '.sh', '.bash', '.zsh',
  '.css', '.scss', '.less', '.svg',
]);

export async function handleWorkspaceRequest(args: WorkspaceArgs): Promise<ToolResponse> {
  switch (args.operation) {
    case 'list':
      return handleList();
    case 'read':
      return handleRead(args);
    case 'write':
      return handleWrite(args);
    case 'delete':
      return handleDelete(args);
    default:
      return { content: [{ type: 'text', text: `Unknown workspace operation: ${args.operation}` }], isError: true };
  }
}

async function handleList(): Promise<ToolResponse> {
  const status = await ensureWorkspaceDir();
  if (!status.valid) {
    return { content: [{ type: 'text', text: `Workspace invalid: ${status.warning}` }], isError: true };
  }

  let entries: string[];
  try {
    entries = await fs.readdir(status.path);
  } catch {
    return { content: [{ type: 'text', text: `Workspace: ${status.path}\n\n(empty — no files staged)` }] };
  }

  if (entries.length === 0) {
    return { content: [{ type: 'text', text: `Workspace: ${status.path}\n\n(empty — no files staged)` }] };
  }

  const lines: string[] = [`Workspace: ${status.path}\n`];
  for (const name of entries.sort()) {
    try {
      const filePath = path.join(status.path, name);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      lines.push(`  ${name}  (${formatSize(stat.size)}, ${stat.mtime.toISOString().slice(0, 16)})`);
    } catch {
      // Skip files we can't stat
    }
  }

  if (lines.length === 1) {
    return { content: [{ type: 'text', text: `Workspace: ${status.path}\n\n(empty — no files staged)` }] };
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function handleRead(args: WorkspaceArgs): Promise<ToolResponse> {
  if (!args.filename) {
    return { content: [{ type: 'text', text: 'filename is required for read operation' }], isError: true };
  }

  const filePath = resolveWorkspacePath(args.filename);
  await verifyPathSafety(filePath);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return { content: [{ type: 'text', text: `File not found in workspace: ${args.filename}` }], isError: true };
  }

  const ext = path.extname(args.filename).toLowerCase();
  const isText = TEXT_EXTENSIONS.has(ext);

  if (isText && stat.size <= TEXT_INLINE_LIMIT) {
    const content = await fs.readFile(filePath, 'utf-8');
    return { content: [{ type: 'text', text: `File: ${args.filename} (${formatSize(stat.size)})\n\n${content}` }] };
  }

  return {
    content: [{
      type: 'text',
      text: `File: ${args.filename} | ${formatSize(stat.size)} | ${isText ? 'text' : 'binary'}\nPath: ${filePath}\n\nUse manage_confluence_media upload with workspaceFile to upload, or manage_workspace delete to remove.`,
    }],
  };
}

async function handleWrite(args: WorkspaceArgs): Promise<ToolResponse> {
  if (!args.filename) {
    return { content: [{ type: 'text', text: 'filename is required for write operation' }], isError: true };
  }
  if (!args.content) {
    return { content: [{ type: 'text', text: 'content (base64-encoded) is required for write operation' }], isError: true };
  }

  const status = await ensureWorkspaceDir();
  if (!status.valid) {
    return { content: [{ type: 'text', text: `Workspace invalid: ${status.warning}` }], isError: true };
  }

  const filePath = resolveWorkspacePath(args.filename);
  await verifyPathSafety(filePath);

  const buffer = Buffer.from(args.content, 'base64');
  await fs.writeFile(filePath, buffer);

  return {
    content: [{
      type: 'text',
      text: `Written: ${path.basename(filePath)} (${formatSize(buffer.length)}) to workspace.`,
    }],
  };
}

async function handleDelete(args: WorkspaceArgs): Promise<ToolResponse> {
  if (!args.filename) {
    return { content: [{ type: 'text', text: 'filename is required for delete operation' }], isError: true };
  }

  const filePath = resolveWorkspacePath(args.filename);
  await verifyPathSafety(filePath);

  try {
    await fs.unlink(filePath);
  } catch {
    return { content: [{ type: 'text', text: `File not found in workspace: ${args.filename}` }], isError: true };
  }

  return { content: [{ type: 'text', text: `Deleted: ${args.filename} from workspace.` }] };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
