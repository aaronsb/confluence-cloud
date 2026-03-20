import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NavigationService } from './navigation-service.js';
import type { ConfluenceClient } from '../client/confluence-client.js';
import type { GraphQLClient } from '../client/graphql-client.js';
import type { Page } from '../types/index.js';

function makePage(id: string, title: string, overrides: Partial<Page> = {}): Page {
  return {
    id,
    title,
    spaceId: 'sp1',
    spaceKey: 'TEST',
    status: 'current',
    version: { number: 1, createdAt: '2026-01-01', authorId: 'u1' },
    createdAt: '2026-01-01',
    authorId: 'u1',
    ...overrides,
  };
}

function mockClient(overrides: Partial<ConfluenceClient> = {}): ConfluenceClient {
  return {
    getPage: vi.fn().mockResolvedValue(makePage('1', 'Root')),
    getChildren: vi.fn().mockResolvedValue({ results: [], cursor: undefined }),
    getAncestors: vi.fn().mockResolvedValue([]),
    getLabels: vi.fn().mockResolvedValue([]),
    searchByCql: vi.fn().mockResolvedValue({ results: [], totalSize: 0 }),
    ...overrides,
  } as unknown as ConfluenceClient;
}

function mockGraphQL(overrides: Partial<GraphQLClient> = {}): GraphQLClient {
  return {
    getIncomingLinks: vi.fn().mockResolvedValue({ pageIds: [], hasMore: false }),
    getOutgoingLinks: vi.fn().mockResolvedValue({ pageIds: [], hasMore: false }),
    ...overrides,
  } as unknown as GraphQLClient;
}

describe('NavigationService', () => {
  describe('getChildren', () => {
    it('should delegate to client', async () => {
      const children = [makePage('2', 'Child A'), makePage('3', 'Child B')];
      const client = mockClient({
        getChildren: vi.fn().mockResolvedValue({ results: children }),
      });
      const nav = new NavigationService(client);
      const result = await nav.getChildren('1');
      expect(result).toEqual(children);
      expect(client.getChildren).toHaveBeenCalledWith('1', { limit: 25 });
    });
  });

  describe('getSiblings', () => {
    it('should return siblings excluding self', async () => {
      const parent = makePage('10', 'Parent');
      const children = [makePage('1', 'Self'), makePage('2', 'Sibling A'), makePage('3', 'Sibling B')];
      const client = mockClient({
        getAncestors: vi.fn().mockResolvedValue([parent]),
        getChildren: vi.fn().mockResolvedValue({ results: children }),
      });
      const nav = new NavigationService(client);
      const result = await nav.getSiblings('1');
      expect(result).toHaveLength(2);
      expect(result.map(p => p.id)).toEqual(['2', '3']);
    });

    it('should return empty when no ancestors', async () => {
      const client = mockClient({ getAncestors: vi.fn().mockResolvedValue([]) });
      const nav = new NavigationService(client);
      expect(await nav.getSiblings('1')).toEqual([]);
    });
  });

  describe('getTree', () => {
    it('should build BFS tree with depth limit', async () => {
      const client = mockClient({
        getPage: vi.fn().mockResolvedValue(makePage('1', 'Root')),
        getChildren: vi.fn()
          .mockResolvedValueOnce({ results: [makePage('2', 'A'), makePage('3', 'B')] })
          .mockResolvedValueOnce({ results: [makePage('4', 'A1')] })
          .mockResolvedValueOnce({ results: [makePage('5', 'B1')] }),
      });

      const nav = new NavigationService(client);
      const tree = await nav.getTree('1', 2, 50);

      expect(tree.page.id).toBe('1');
      expect(tree.children).toHaveLength(2);
      expect(tree.children[0].children).toHaveLength(1);
    });

    it('should respect maxNodes limit', async () => {
      const client = mockClient({
        getPage: vi.fn().mockResolvedValue(makePage('1', 'Root')),
        getChildren: vi.fn().mockResolvedValue({
          results: Array.from({ length: 10 }, (_, i) => makePage(`${i + 2}`, `Child ${i}`)),
        }),
      });

      const nav = new NavigationService(client);
      const tree = await nav.getTree('1', 3, 4);

      // Root + 3 children = 4 nodes (maxNodes)
      const flat = nav.flattenTree(tree);
      expect(flat.length).toBeLessThanOrEqual(4);
    });
  });

  describe('getBacklinks', () => {
    it('should use GraphQL when available', async () => {
      const gql = mockGraphQL({
        getIncomingLinks: vi.fn().mockResolvedValue({ pageIds: ['10', '20'], hasMore: false }),
      });
      const client = mockClient({
        getPage: vi.fn()
          .mockResolvedValueOnce(makePage('10', 'Linker A'))
          .mockResolvedValueOnce(makePage('20', 'Linker B')),
      });

      const nav = new NavigationService(client, gql);
      const result = await nav.getBacklinks('1');

      expect(gql.getIncomingLinks).toHaveBeenCalledWith('1');
      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Linker A');
    });

    it('should fall back to CQL when no GraphQL', async () => {
      const client = mockClient({
        getPage: vi.fn().mockResolvedValue(makePage('1', 'Target Page')),
        searchByCql: vi.fn().mockResolvedValue({
          results: [{ content: makePage('10', 'Linker'), excerpt: '', lastModified: '', url: '' }],
          totalSize: 1,
        }),
      });

      const nav = new NavigationService(client);
      const result = await nav.getBacklinks('1');

      expect(client.searchByCql).toHaveBeenCalledWith(
        expect.stringContaining('Target Page'),
        expect.any(Object),
      );
      expect(result).toHaveLength(1);
    });

    it('should return empty when no backlinks', async () => {
      const gql = mockGraphQL();
      const nav = new NavigationService(mockClient(), gql);
      expect(await nav.getBacklinks('1')).toEqual([]);
    });
  });

  describe('getForwardLinks', () => {
    it('should use GraphQL when available', async () => {
      const gql = mockGraphQL({
        getOutgoingLinks: vi.fn().mockResolvedValue({ pageIds: ['5'], hasMore: false }),
      });
      const client = mockClient({
        getPage: vi.fn().mockResolvedValue(makePage('5', 'Linked Page')),
      });

      const nav = new NavigationService(client, gql);
      const result = await nav.getForwardLinks('1');

      expect(gql.getOutgoingLinks).toHaveBeenCalledWith('1');
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Linked Page');
    });

    it('should fall back to ADF parsing when no GraphQL', async () => {
      const client = mockClient({
        getPage: vi.fn().mockResolvedValue(makePage('1', 'Page', {
          body: {
            atlas_doc_format: {
              type: 'doc',
              content: [{
                type: 'paragraph',
                content: [{
                  type: 'text',
                  text: 'See this page',
                  marks: [{ type: 'link', attrs: { href: 'https://example.com/wiki/spaces/TEST/pages/99/target' } }],
                }],
              }],
            },
          },
        })),
      });

      const nav = new NavigationService(client);
      const result = await nav.getForwardLinks('1');

      expect(result).toHaveLength(1);
      expect(result[0].pageId).toBe('99');
      expect(result[0].text).toBe('See this page');
    });

    it('should return empty when no body', async () => {
      const client = mockClient({
        getPage: vi.fn().mockResolvedValue(makePage('1', 'No body')),
      });
      const nav = new NavigationService(client);
      expect(await nav.getForwardLinks('1')).toEqual([]);
    });
  });

  describe('getRelated', () => {
    it('should find pages with shared labels', async () => {
      const client = mockClient({
        getLabels: vi.fn().mockResolvedValue(['api', 'docs']),
        searchByCql: vi.fn().mockResolvedValue({
          results: [{ content: makePage('10', 'Related'), excerpt: '', lastModified: '', url: '' }],
          totalSize: 1,
        }),
      });

      const nav = new NavigationService(client);
      const result = await nav.getRelated('1');

      expect(result.pages).toHaveLength(1);
      const cql = (client.searchByCql as any).mock.calls[0][0];
      expect(cql).toContain('"api"');
      expect(cql).toContain('"docs"');
      expect(cql).toContain('id != "1"');
    });

    it('should return empty when page has no labels', async () => {
      const client = mockClient({ getLabels: vi.fn().mockResolvedValue([]) });
      const nav = new NavigationService(client);
      const result = await nav.getRelated('1');
      expect(result.pages).toEqual([]);
    });
  });

  describe('flattenTree', () => {
    it('should flatten nested tree to list with depth', () => {
      const nav = new NavigationService(mockClient());
      const tree = {
        page: makePage('1', 'Root'),
        depth: 0,
        children: [
          { page: makePage('2', 'A'), depth: 1, children: [
            { page: makePage('3', 'A1'), depth: 2, children: [] },
          ]},
          { page: makePage('4', 'B'), depth: 1, children: [] },
        ],
      };

      const flat = nav.flattenTree(tree);
      expect(flat).toHaveLength(4);
      expect(flat.map(f => f.depth)).toEqual([0, 1, 2, 1]);
      expect(flat.map(f => f.page.id)).toEqual(['1', '2', '3', '4']);
    });
  });

  describe('setGraphQLClient', () => {
    it('should switch from REST to GraphQL for backlinks', async () => {
      const client = mockClient();
      const nav = new NavigationService(client);

      // Initially no GraphQL — uses CQL fallback
      await nav.getBacklinks('1');
      expect(client.searchByCql).toHaveBeenCalled();

      // Attach GraphQL
      const gql = mockGraphQL({
        getIncomingLinks: vi.fn().mockResolvedValue({ pageIds: [], hasMore: false }),
      });
      nav.setGraphQLClient(gql);

      await nav.getBacklinks('1');
      expect(gql.getIncomingLinks).toHaveBeenCalledWith('1');
    });
  });
});
