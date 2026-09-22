import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfluenceRestClient } from './confluence-client.js';

// Locks the endpoint contract from #16: label READS use the v2 API, label
// WRITES must use the v1 API — the v2 /pages/{id}/labels endpoint is
// read-only and answers POST/DELETE with 405.
describe('ConfluenceRestClient labels', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
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

  it('reads labels from the v2 endpoint', async () => {
    await client.getLabels('123');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.atlassian.net/wiki/api/v2/pages/123/labels');
    expect(options?.method).toBeUndefined();
  });

  it('adds labels through the v1 endpoint', async () => {
    await client.addLabels('123', ['alpha', 'beta']);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.atlassian.net/wiki/rest/api/content/123/label');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual([
      { prefix: 'global', name: 'alpha' },
      { prefix: 'global', name: 'beta' },
    ]);
  });

  it('removes a label through the v1 endpoint, name as query param', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await client.removeLabel('123', 'needs review');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.atlassian.net/wiki/rest/api/content/123/label?name=needs%20review');
    expect(options.method).toBe('DELETE');
  });
});

// #19: CQL failures must surface a CQL diagnostic, not a JS TypeError.
describe('ConfluenceRestClient searchByCql errors', () => {
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

  it('surfaces the message from a 400 error body', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      statusCode: 400,
      message: 'Could not parse cql : type = bogus',
    }), { status: 400 }));
    await expect(client.searchByCql('type = bogus')).rejects.toThrow(
      'Invalid CQL: Could not parse cql : type = bogus. CQL: type = bogus',
    );
  });

  it('keeps a non-JSON 400 body verbatim', async () => {
    fetchMock.mockResolvedValue(new Response('bad query', { status: 400 }));
    await expect(client.searchByCql('type = bogus')).rejects.toThrow('Invalid CQL: bad query');
  });

  it('passes non-400 errors through unchanged', async () => {
    fetchMock.mockResolvedValue(new Response('{"message":"nope"}', { status: 403 }));
    await expect(client.searchByCql('type = page')).rejects.toThrow('Confluence API error 403');
  });

  it('explains non-content-only results instead of dereferencing undefined', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      results: [{ space: { key: 'ABC' }, entityType: 'space', title: 'ABC' }],
      totalSize: 1,
    }), { status: 200 }));
    await expect(client.searchByCql('type = space AND space.type = "personal"')).rejects.toThrow(
      /CQL matched only space results; search_confluence returns content only/,
    );
  });

  it('drops non-content hits mixed in with content hits', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      results: [
        { space: { key: 'ABC' }, entityType: 'space' },
        { content: { id: '42', title: 'Page', type: 'page', status: 'current' }, entityType: 'content' },
      ],
      totalSize: 2,
    }), { status: 200 }));
    const result = await client.searchByCql('text ~ "abc"');
    expect(result.results.map(r => r.content.id)).toEqual(['42']);
  });
});
