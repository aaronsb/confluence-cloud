import { describe, it, expect, vi } from 'vitest';
import { handlePageRequest } from './page-handler.js';
import type { ConfluenceClient } from '../client/confluence-client.js';
import type { PageComment } from '../types/index.js';
import type { ScratchpadManager } from '../sessions/scratchpad.js';

const para = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const comments: PageComment[] = [
  { id: '1', pageId: '123', location: 'footer', author: 'Ada', createdAt: '2026-07-08T12:00:00.000Z', body: para('First thought') },
  { id: '2', pageId: '123', location: 'footer', parentId: '1', author: 'Bob', createdAt: '2026-07-09T12:00:00.000Z', body: para('Agreed') },
  { id: '3', pageId: '123', location: 'inline', author: 'Cy', createdAt: '2026-07-10T12:00:00.000Z', body: para('Check this number'), resolutionStatus: 'resolved', inlineSelection: '$18,507.51' },
];

function stubClient(overrides: Partial<ConfluenceClient> = {}): ConfluenceClient {
  return {
    getComments: vi.fn().mockResolvedValue(comments),
    addComment: vi.fn().mockResolvedValue({ id: '9', pageId: '123', location: 'footer', author: '', createdAt: '' }),
    ...overrides,
  } as unknown as ConfluenceClient;
}
const scratchpads = {} as ScratchpadManager;

describe('manage_confluence_page comments', () => {
  it('renders footer threads and inline comments with selection and status', async () => {
    const res = await handlePageRequest(stubClient(), scratchpads, { operation: 'get_comments', pageId: '123' });
    const text = res.content[0].text!;
    expect(res.isError).toBeUndefined();
    expect(text).toContain('Comments on page 123: 2 footer, 1 inline, 1 resolved');
    expect(text).toContain('[1] Ada (Jul 8, 2026) — id 1');
    expect(text).toContain('First thought');
    expect(text).toContain('  [1.1] Bob (Jul 9, 2026) — id 2');
    expect(text).toContain('  Agreed');
    expect(text).toContain('[1] Cy (Jul 10, 2026) — id 3 — resolved');
    expect(text).toContain('> $18,507.51');
    expect(text).toContain('"operation":"add_comment"');
  });

  it('says so when a page has no comments', async () => {
    const client = stubClient({ getComments: vi.fn().mockResolvedValue([]) });
    const res = await handlePageRequest(client, scratchpads, { operation: 'get_comments', pageId: '123' });
    expect(res.content[0].text).toContain('No comments on page 123.');
  });

  it('adds a footer comment from markdown without reading the page first', async () => {
    const client = stubClient();
    const res = await handlePageRequest(client, scratchpads, { operation: 'add_comment', pageId: '123', body: 'Looks **good**' });
    expect(res.isError).toBeUndefined();
    expect(client.getComments).not.toHaveBeenCalled();
    const [pageId, adf, opts] = (client.addComment as any).mock.calls[0];
    expect(pageId).toBe('123');
    expect(JSON.stringify(adf)).toContain('"text":"good"');
    expect(opts).toEqual({ parentCommentId: undefined, location: 'footer' });
    expect(res.content[0].text).toContain('Comment added: id 9');
  });

  it('routes a reply to the parent comment location', async () => {
    const client = stubClient();
    const res = await handlePageRequest(client, scratchpads, { operation: 'add_comment', pageId: '123', body: 'Fixed', parentCommentId: '3' });
    expect(res.isError).toBeUndefined();
    const [, , opts] = (client.addComment as any).mock.calls[0];
    expect(opts).toEqual({ parentCommentId: '3', location: 'inline' });
    expect(res.content[0].text).toContain('Reply to 3 added');
  });

  it('rejects a reply to an unknown parent and an empty body', async () => {
    const client = stubClient();
    const missing = await handlePageRequest(client, scratchpads, { operation: 'add_comment', pageId: '123', body: 'x', parentCommentId: '404' });
    expect(missing.isError).toBe(true);
    expect(client.addComment).not.toHaveBeenCalled();
    const empty = await handlePageRequest(client, scratchpads, { operation: 'add_comment', pageId: '123', body: '  ' });
    expect(empty.isError).toBe(true);
  });
});
