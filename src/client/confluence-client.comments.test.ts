import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfluenceRestClient } from './confluence-client.js';

// Locks the endpoint split from ADR-503: comment READS use v1 depth=all (one call for
// both locations, replies and authors); comment WRITES use the v2 location endpoints.
describe('ConfluenceRestClient comments', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const client = new ConfluenceRestClient({
    host: 'https://example.atlassian.net',
    email: 'user@example.com',
    apiToken: 'token',
  });

  const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] };

  it('reads footer and inline comments through v1 with depth=all and maps threading', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      results: [
        {
          id: '1', body: { atlas_doc_format: { value: JSON.stringify(adf) } },
          version: { when: '2026-07-08T14:27:06.132Z', by: { displayName: 'Ada', accountId: 'a1' } },
          ancestors: [], extensions: { location: 'footer', resolution: { status: 'open' } },
        },
        {
          id: '2', body: { atlas_doc_format: { value: JSON.stringify(adf) } },
          version: { when: '2026-07-09T00:00:00.000Z', by: { displayName: 'Bob' } },
          ancestors: [{ id: '1' }], extensions: { location: 'footer' },
        },
        {
          id: '3', body: { atlas_doc_format: { value: JSON.stringify(adf) } },
          version: { when: '2026-07-10T00:00:00.000Z', by: { displayName: 'Cy' } },
          ancestors: [],
          extensions: { location: 'inline', resolution: { status: 'resolved' }, inlineProperties: { originalSelection: 'the quoted text' } },
        },
      ],
    }), { status: 200 }));

    const comments = await client.getComments('123');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/example\.atlassian\.net\/wiki\/rest\/api\/content\/123\/child\/comment\?/);
    expect(url).toContain('depth=all');
    expect(url).toContain('body.atlas_doc_format');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(comments).toHaveLength(3);
    expect(comments[0]).toMatchObject({ id: '1', location: 'footer', author: 'Ada', parentId: undefined, body: adf });
    expect(comments[1]).toMatchObject({ id: '2', parentId: '1', author: 'Bob' });
    expect(comments[2]).toMatchObject({ id: '3', location: 'inline', resolutionStatus: 'resolved', inlineSelection: 'the quoted text' });
  });

  it('pages through v1 results with start until a short page arrives', async () => {
    const page = (n: number, from: number) => ({
      results: Array.from({ length: n }, (_, i) => ({ id: String(from + i), extensions: { location: 'footer' } })),
    });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(page(100, 0)), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page(3, 100)), { status: 200 }));

    const comments = await client.getComments('123');
    expect(comments).toHaveLength(103);
    expect(fetchMock.mock.calls[0][0]).toContain('start=0');
    expect(fetchMock.mock.calls[1][0]).toContain('start=100');
  });

  it('posts a footer comment through v2 with the ADF body as a JSON string', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: '9', pageId: '123' }), { status: 200 }));
    const created = await client.addComment('123', adf);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.atlassian.net/wiki/api/v2/footer-comments');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      pageId: '123',
      body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) },
    });
    expect(created).toMatchObject({ id: '9', pageId: '123', location: 'footer' });
  });

  it('posts a reply to an inline thread through the inline endpoint', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: '10', parentCommentId: '3' }), { status: 200 }));
    await client.addComment('123', adf, { parentCommentId: '3', location: 'inline' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.atlassian.net/wiki/api/v2/inline-comments');
    expect(JSON.parse(options.body).parentCommentId).toBe('3');
  });
});
