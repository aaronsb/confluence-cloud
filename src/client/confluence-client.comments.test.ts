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
    expect(url).toContain('history');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(comments).toHaveLength(3);
    expect(comments[0]).toMatchObject({ id: '1', location: 'footer', author: 'Ada', parentId: undefined, body: adf });
    expect(comments[1]).toMatchObject({ id: '2', parentId: '1', author: 'Bob' });
    expect(comments[2]).toMatchObject({ id: '3', location: 'inline', resolutionStatus: 'resolved', inlineSelection: 'the quoted text' });
  });

  it('prefers `history` (original author/creation) over `version` (last edit), falling back when history is absent', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      results: [
        {
          id: '1', extensions: { location: 'footer' },
          history: { createdDate: '2026-01-01T00:00:00.000Z', createdBy: { displayName: 'Original Author', accountId: 'orig1' } },
          version: { when: '2026-07-08T14:27:06.132Z', by: { displayName: 'Editor', accountId: 'ed1' } },
        },
        {
          id: '2', extensions: { location: 'footer' },
          version: { when: '2026-07-09T00:00:00.000Z', by: { displayName: 'Bob' } },
        },
      ],
    }), { status: 200 }));

    const comments = await client.getComments('123');
    expect(comments[0]).toMatchObject({ id: '1', author: 'Original Author', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(comments[1]).toMatchObject({ id: '2', author: 'Bob', createdAt: '2026-07-09T00:00:00.000Z' });
  });

  it('pages through v1 results with start while `_links.next` is present', async () => {
    const page = (n: number, from: number, next?: string) => ({
      results: Array.from({ length: n }, (_, i) => ({ id: String(from + i), extensions: { location: 'footer' } })),
      ...(next ? { _links: { next } } : {}),
    });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(page(100, 0, '/rest/api/content/123/child/comment?start=100&limit=100')), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page(3, 100)), { status: 200 }));

    const comments = await client.getComments('123');
    expect(comments).toHaveLength(103);
    expect(fetchMock.mock.calls[0][0]).toContain('start=0');
    expect(fetchMock.mock.calls[1][0]).toContain('start=100');
  });

  it('keeps paging on short pages while `_links.next` is present, and stops once it is absent', async () => {
    // Confluence v1 can silently cap the page size below the requested `limit`, reporting
    // the real cap in `raw.limit`. A short page must not be treated as the last page —
    // only the absence of `_links.next` should stop the loop.
    const page = (ids: string[], next?: string) => ({
      results: ids.map(id => ({ id, extensions: { location: 'footer' } })),
      limit: 25,
      ...(next ? { _links: { next } } : {}),
    });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(page(['1', '2'], '/rest/api/content/123/child/comment?start=2&limit=100')), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page(['3', '4'], '/rest/api/content/123/child/comment?start=4&limit=100')), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page(['5'])), { status: 200 }));

    const comments = await client.getComments('123');
    expect(comments.map(c => c.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain('start=0');
    expect(fetchMock.mock.calls[1][0]).toContain('start=2');
    expect(fetchMock.mock.calls[2][0]).toContain('start=4');
  });

  it('stops on an empty page even if `_links.next` were somehow present, to avoid looping forever', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      results: [], _links: { next: '/rest/api/content/123/child/comment?start=0&limit=100' },
    }), { status: 200 }));

    const comments = await client.getComments('123');
    expect(comments).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
