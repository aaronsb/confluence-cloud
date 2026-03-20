import { describe, it, expect, vi } from 'vitest';
import { handleSearchRequest } from './search-handler.js';
import type { ConfluenceClient } from '../client/confluence-client.js';
import type { SearchResult } from '../types/index.js';

function mockClient(results: Partial<SearchResult> = {}): ConfluenceClient {
  return {
    searchByCql: vi.fn().mockResolvedValue({
      results: [],
      totalSize: 0,
      ...results,
    }),
  } as unknown as ConfluenceClient;
}

describe('handleSearchRequest', () => {
  it('should reject cql operation without cql param', async () => {
    const result = await handleSearchRequest(mockClient(), { operation: 'cql' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('cql is required');
  });

  it('should pass through raw CQL', async () => {
    const client = mockClient();
    await handleSearchRequest(client, { operation: 'cql', cql: 'type = page' });
    expect(client.searchByCql).toHaveBeenCalledWith('type = page', { cursor: undefined, limit: 25 });
  });

  it('should build fulltext CQL', async () => {
    const client = mockClient();
    await handleSearchRequest(client, { operation: 'fulltext', query: 'hello world' });
    expect(client.searchByCql).toHaveBeenCalledWith(
      expect.stringContaining('text ~ "hello world"'),
      expect.any(Object),
    );
  });

  it('should reject fulltext without query', async () => {
    const result = await handleSearchRequest(mockClient(), { operation: 'fulltext' });
    expect(result.isError).toBe(true);
  });

  it('should build by_label CQL with multiple labels', async () => {
    const client = mockClient();
    await handleSearchRequest(client, { operation: 'by_label', labels: ['api', 'docs'] });
    const cql = (client.searchByCql as any).mock.calls[0][0];
    expect(cql).toContain('label IN');
    expect(cql).toContain('"api"');
    expect(cql).toContain('"docs"');
  });

  it('should reject by_label without labels', async () => {
    const result = await handleSearchRequest(mockClient(), { operation: 'by_label' });
    expect(result.isError).toBe(true);
  });

  it('should build by_contributor CQL', async () => {
    const client = mockClient();
    await handleSearchRequest(client, { operation: 'by_contributor', contributor: 'user@example.com' });
    const cql = (client.searchByCql as any).mock.calls[0][0];
    expect(cql).toContain('contributor = "user@example.com"');
  });

  it('should add spaceKey filter when provided', async () => {
    const client = mockClient();
    await handleSearchRequest(client, { operation: 'fulltext', query: 'test', spaceKey: 'ENG' });
    const cql = (client.searchByCql as any).mock.calls[0][0];
    expect(cql).toContain('space = "ENG"');
  });

  it('should handle recent operation', async () => {
    const client = mockClient();
    await handleSearchRequest(client, { operation: 'recent' });
    const cql = (client.searchByCql as any).mock.calls[0][0];
    expect(cql).toContain('ORDER BY lastmodified DESC');
  });

  it('should escape CQL injection in values', async () => {
    const client = mockClient();
    await handleSearchRequest(client, { operation: 'fulltext', query: 'test" AND type = "blogpost' });
    const cql = (client.searchByCql as any).mock.calls[0][0];
    expect(cql).toContain('test\\" AND type = \\"blogpost');
    expect(cql).not.toContain('AND type = "blogpost"');
  });

  it('should reject unknown operation', async () => {
    const result = await handleSearchRequest(mockClient(), { operation: 'bogus' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown search operation');
  });

  it('should pass pagination params', async () => {
    const client = mockClient();
    await handleSearchRequest(client, { operation: 'recent', cursor: 'xyz', limit: 10 });
    expect(client.searchByCql).toHaveBeenCalledWith(expect.any(String), { cursor: 'xyz', limit: 10 });
  });
});
