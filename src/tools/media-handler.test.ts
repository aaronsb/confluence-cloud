import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleMediaRequest } from './media-handler.js';
import type { ConfluenceClient } from '../client/confluence-client.js';
import type { Attachment } from '../types/index.js';

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'att1',
    title: 'test.png',
    mediaType: 'image/png',
    fileSize: 1024,
    downloadUrl: '/download/att1',
    pageId: '100',
    version: 1,
    createdAt: '2026-01-01',
    ...overrides,
  };
}

function mockClient(overrides: Partial<ConfluenceClient> = {}): ConfluenceClient {
  return {
    getAttachmentInfo: vi.fn().mockResolvedValue(makeAttachment()),
    downloadAttachment: vi.fn().mockResolvedValue(Buffer.from('fake-image-bytes')),
    getAttachments: vi.fn().mockResolvedValue({ results: [] }),
    ...overrides,
  } as unknown as ConfluenceClient;
}

describe('handleMediaRequest — view operation', () => {
  it('should require attachmentId', async () => {
    const result = await handleMediaRequest(mockClient(), { operation: 'view' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('attachmentId is required');
  });

  it('should return image content for image attachments', async () => {
    const client = mockClient();
    const result = await handleMediaRequest(client, { operation: 'view', attachmentId: 'att1' });

    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('text');
    expect(result.content[1].type).toBe('image');
    expect(result.content[1].mimeType).toBe('image/png');
    expect(result.content[1].data).toBe(Buffer.from('fake-image-bytes').toString('base64'));
  });

  it('should return text-only for non-image attachments', async () => {
    const client = mockClient({
      getAttachmentInfo: vi.fn().mockResolvedValue(makeAttachment({ mediaType: 'application/pdf', title: 'doc.pdf' })),
    });
    const result = await handleMediaRequest(client, { operation: 'view', attachmentId: 'att1' });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Not an image');
  });

  it('should reject images over 5MB', async () => {
    const client = mockClient({
      getAttachmentInfo: vi.fn().mockResolvedValue(makeAttachment({ fileSize: 6 * 1024 * 1024 })),
    });
    const result = await handleMediaRequest(client, { operation: 'view', attachmentId: 'att1' });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toContain('too large');
    expect(client.downloadAttachment).not.toHaveBeenCalled();
  });
});

describe('handleMediaRequest — get_info operation', () => {
  it('should return attachment info', async () => {
    const client = mockClient();
    const result = await handleMediaRequest(client, { operation: 'get_info', attachmentId: 'att1' });

    expect(result.content[0].text).toContain('test.png');
    expect(result.content[0].text).toContain('image/png');
  });

  it('should require attachmentId', async () => {
    const result = await handleMediaRequest(mockClient(), { operation: 'get_info' });
    expect(result.isError).toBe(true);
  });
});

describe('handleMediaRequest — download operation', () => {
  let tmpDir: string;
  const originalWD = process.env.WORKSPACE_DIR;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-dl-'));
    process.env.WORKSPACE_DIR = tmpDir;
  });

  afterEach(async () => {
    if (originalWD !== undefined) process.env.WORKSPACE_DIR = originalWD;
    else delete process.env.WORKSPACE_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should download attachment to workspace', async () => {
    const client = mockClient();
    const result = await handleMediaRequest(client, { operation: 'download', attachmentId: 'att1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Downloaded');
    expect(result.content[0].text).toContain('test.png');

    const written = await fs.readFile(path.join(tmpDir, 'test.png'));
    expect(written.toString()).toBe('fake-image-bytes');
  });

  it('should use custom filename if provided', async () => {
    const client = mockClient();
    await handleMediaRequest(client, { operation: 'download', attachmentId: 'att1', filename: 'custom.png' });

    const written = await fs.readFile(path.join(tmpDir, 'custom.png'));
    expect(written.toString()).toBe('fake-image-bytes');
  });

  it('should require attachmentId for download', async () => {
    const result = await handleMediaRequest(mockClient(), { operation: 'download' });
    expect(result.isError).toBe(true);
  });
});

describe('handleMediaRequest — upload from workspace', () => {
  let tmpDir: string;
  const originalWD = process.env.WORKSPACE_DIR;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-ul-'));
    process.env.WORKSPACE_DIR = tmpDir;
  });

  afterEach(async () => {
    if (originalWD !== undefined) process.env.WORKSPACE_DIR = originalWD;
    else delete process.env.WORKSPACE_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should upload from workspace file', async () => {
    await fs.writeFile(path.join(tmpDir, 'diagram.png'), Buffer.from('png-bytes'));

    const uploadFn = vi.fn().mockResolvedValue(makeAttachment({ title: 'diagram.png' }));
    const client = mockClient({ uploadAttachment: uploadFn });

    const result = await handleMediaRequest(client, {
      operation: 'upload',
      pageId: '100',
      filename: 'diagram.png',
      mediaType: 'image/png',
      workspaceFile: 'diagram.png',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Uploaded');
    expect(uploadFn).toHaveBeenCalledWith('100', 'diagram.png', Buffer.from('png-bytes'), 'image/png');
  });

  it('should return error for missing workspace file', async () => {
    const client = mockClient();
    const result = await handleMediaRequest(client, {
      operation: 'upload',
      pageId: '100',
      filename: 'missing.png',
      mediaType: 'image/png',
      workspaceFile: 'missing.png',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('should still work with base64 content', async () => {
    const uploadFn = vi.fn().mockResolvedValue(makeAttachment());
    const client = mockClient({ uploadAttachment: uploadFn });

    const result = await handleMediaRequest(client, {
      operation: 'upload',
      pageId: '100',
      filename: 'test.png',
      mediaType: 'image/png',
      content: Buffer.from('base64-bytes').toString('base64'),
    });

    expect(result.isError).toBeUndefined();
    expect(uploadFn).toHaveBeenCalled();
  });

  it('should require either content or workspaceFile', async () => {
    const result = await handleMediaRequest(mockClient(), {
      operation: 'upload',
      pageId: '100',
      filename: 'test.png',
      mediaType: 'image/png',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('content');
  });
});
