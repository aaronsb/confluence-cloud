import { describe, it, expect, vi } from 'vitest';
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
