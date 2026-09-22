import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfluenceRestClient } from './confluence-client.js';

// Locks ADR-503: comment reads and writes both use v2. Reads list each location,
// fan out to `children` for replies, fetch `versions/1` for edited comments, and
// resolve author names through `users-bulk`.
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
  const V2 = 'https://example.atlassian.net/wiki/api/v2';
  const body = { atlas_doc_format: { value: JSON.stringify(adf) } };
  const ver = (authorId: string, createdAt: string, number = 1) => ({ number, authorId, createdAt });
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

  /** Route fetch by URL path; unrouted list endpoints answer empty. */
  function route(routes: Record<string, unknown | ((init?: RequestInit) => unknown)>) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname.replace('/wiki/api/v2', '');
      const key = `${path}${new URL(url).searchParams.get('cursor') ? `#${new URL(url).searchParams.get('cursor')}` : ''}`;
      const hit = routes[key] ?? routes[path];
      if (hit !== undefined) return json(typeof hit === 'function' ? (hit as (i?: RequestInit) => unknown)(init) : hit);
      if (path === '/users-bulk') return json({ results: [] });
      return json({ results: [] });
    });
  }
  const calls = () => fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname.replace('/wiki/api/v2', ''));

  it('reads both locations through v2, walks replies, and resolves author names', async () => {
    route({
      '/pages/123/footer-comments': { results: [
        { id: '1', pageId: '123', body, version: ver('a1', '2026-07-08T14:27:06.132Z'), resolutionStatus: 'open' },
      ] },
      '/pages/123/inline-comments': { results: [
        { id: '3', pageId: '123', body, version: ver('c1', '2026-07-10T00:00:00.000Z'), resolutionStatus: 'resolved',
          properties: { inlineOriginalSelection: 'the quoted text', inlineMarkerRef: 'm1' } },
      ] },
      '/footer-comments/1/children': { results: [
        { id: '2', pageId: '123', parentCommentId: '1', body, version: ver('b1', '2026-07-09T00:00:00.000Z') },
      ] },
      '/footer-comments/2/children': { results: [
        { id: '4', pageId: '123', parentCommentId: '2', body, version: ver('a1', '2026-07-09T01:00:00.000Z') },
      ] },
      '/users-bulk': { results: [
        { accountId: 'a1', displayName: 'Ada' }, { accountId: 'b1', displayName: 'Bob' }, { accountId: 'c1', displayName: 'Cy' },
      ] },
    });

    const comments = await client.getComments('123');

    const [firstUrl] = fetchMock.mock.calls[0];
    expect(firstUrl).toMatch(new RegExp(`^${V2}/pages/123/footer-comments\\?`));
    expect(firstUrl).toContain('body-format=atlas_doc_format');
    expect(firstUrl).toContain('limit=100');
    expect(calls()).not.toContainEqual(expect.stringContaining('/rest/api'));
    // Replies of replies are fetched too; leaves are probed once and come back empty.
    expect(calls()).toEqual(expect.arrayContaining([
      '/footer-comments/1/children', '/inline-comments/3/children', '/footer-comments/2/children', '/footer-comments/4/children',
    ]));
    const bulk = fetchMock.mock.calls.filter(([url]) => (url as string).endsWith('/users-bulk'));
    expect(bulk).toHaveLength(1);
    expect(bulk[0][1].method).toBe('POST');
    expect(JSON.parse(bulk[0][1].body).accountIds.sort()).toEqual(['a1', 'b1', 'c1']);

    expect(comments).toHaveLength(4);
    const byId = Object.fromEntries(comments.map(c => [c.id, c]));
    expect(byId['1']).toMatchObject({ location: 'footer', author: 'Ada', parentId: undefined, body: adf, pageId: '123' });
    expect(byId['2']).toMatchObject({ location: 'footer', parentId: '1', author: 'Bob' });
    expect(byId['4']).toMatchObject({ location: 'footer', parentId: '2', author: 'Ada' });
    expect(byId['3']).toMatchObject({ location: 'inline', resolutionStatus: 'resolved', inlineSelection: 'the quoted text', author: 'Cy' });
  });

  it('reads the hyphenated inline selection property when the camelCase one is absent', async () => {
    route({
      '/pages/123/inline-comments': { results: [
        { id: '3', version: ver('c1', '2026-07-10T00:00:00.000Z'), properties: { 'inline-original-selection': 'quoted' } },
      ] },
    });
    const [c] = await client.getComments('123');
    expect(c).toMatchObject({ id: '3', inlineSelection: 'quoted', pageId: '123' });
  });

  it('takes author and date from version 1 for edited comments, not the last editor', async () => {
    route({
      '/pages/123/footer-comments': { results: [
        { id: '1', version: ver('ed1', '2026-07-08T14:27:06.132Z', 3) },
        { id: '2', version: ver('b1', '2026-07-09T00:00:00.000Z', 1) },
      ] },
      '/footer-comments/1/versions/1': { number: 1, authorId: 'orig1', createdAt: '2026-01-01T00:00:00.000Z' },
      '/users-bulk': { results: [{ accountId: 'orig1', displayName: 'Original Author' }, { accountId: 'b1', displayName: 'Bob' }] },
    });

    const comments = await client.getComments('123');
    expect(comments[0]).toMatchObject({ id: '1', author: 'Original Author', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(comments[1]).toMatchObject({ id: '2', author: 'Bob', createdAt: '2026-07-09T00:00:00.000Z' });
    expect(calls()).toContain('/footer-comments/1/versions/1');
    expect(calls()).not.toContain('/footer-comments/2/versions/1');
    expect(JSON.parse(fetchMock.mock.calls.find(([u]) => (u as string).endsWith('/users-bulk'))![1].body).accountIds)
      .not.toContain('ed1');
  });

  it('follows the `_links.next` cursor on list endpoints', async () => {
    const mk = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: String(from + i), version: ver('a1', '') }));
    route({
      '/pages/123/footer-comments': { results: mk(0, 100), _links: { next: '/wiki/api/v2/pages/123/footer-comments?limit=100&cursor=abc' } },
      '/pages/123/footer-comments#abc': { results: mk(100, 3) },
    });

    const comments = await client.getComments('123');
    expect(comments).toHaveLength(103);
    const listCalls = fetchMock.mock.calls.map(([u]) => u as string).filter(u => u.includes('/pages/123/footer-comments'));
    expect(listCalls).toHaveLength(2);
    expect(listCalls[1]).toContain('cursor=abc');
  });

  it('stops on an empty page even if `_links.next` were somehow present, to avoid looping forever', async () => {
    route({
      '/pages/123/footer-comments': { results: [], _links: { next: '/wiki/api/v2/pages/123/footer-comments?cursor=abc' } },
    });
    const comments = await client.getComments('123');
    expect(comments).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([u]) => (u as string).includes('/footer-comments'))).toHaveLength(1);
  });

  it('caps in-flight children calls at 5', async () => {
    const top = Array.from({ length: 12 }, (_, i) => ({ id: String(i), version: ver('a1', '') }));
    let inFlight = 0;
    let peak = 0;
    fetchMock.mockImplementation(async (url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/pages/123/footer-comments')) return json({ results: top });
      if (path.endsWith('/children')) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise(r => setTimeout(r, 1));
        inFlight--;
      }
      return json({ results: [] });
    });
    await client.getComments('123');
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it('batches users-bulk at 250 account ids per call', async () => {
    const top = Array.from({ length: 260 }, (_, i) => ({ id: String(i), version: ver(`u${i}`, '') }));
    route({ '/pages/123/footer-comments': { results: top } });
    await client.getComments('123');
    const bulk = fetchMock.mock.calls.filter(([u]) => (u as string).endsWith('/users-bulk'));
    expect(bulk.map(([, init]) => JSON.parse(init.body).accountIds.length)).toEqual([250, 10]);
  });

  it('falls back to account ids when users-bulk fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockImplementation(async (url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/pages/123/footer-comments')) return json({ results: [{ id: '1', version: ver('a1', '') }] });
      if (path.endsWith('/users-bulk')) return new Response('forbidden', { status: 403 });
      return json({ results: [] });
    });
    const [c] = await client.getComments('123');
    expect(c.author).toBe('a1');
    errSpy.mockRestore();
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
