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
