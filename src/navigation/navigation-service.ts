/**
 * Navigation service — traverses page hierarchy and relationships.
 * See ADR-400: Graph-Native Page Navigation.
 */

import type { ConfluenceClient } from '../client/confluence-client.js';
import type { GraphQLClient } from '../client/graphql-client.js';
import type { Page } from '../types/index.js';
import type { AdfNode } from '../content/adf-parser.js';

function escapeCql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export interface TreeNode {
  page: Page;
  depth: number;
  children: TreeNode[];
}

export class NavigationService {
  private graphql: GraphQLClient | null;

  constructor(private client: ConfluenceClient, graphql?: GraphQLClient | null) {
    this.graphql = graphql ?? null;
  }

  setGraphQLClient(graphql: GraphQLClient): void {
    this.graphql = graphql;
  }

  /**
   * Get direct children of a page.
   */
  async getChildren(pageId: string, limit?: number): Promise<Page[]> {
    const result = await this.client.getChildren(pageId, { limit: limit ?? 25 });
    return result.results;
  }

  /**
   * Get ancestors from page to space root.
   */
  async getAncestors(pageId: string): Promise<Page[]> {
    return this.client.getAncestors(pageId);
  }

  /**
   * Get siblings (pages at the same level).
   */
  async getSiblings(pageId: string): Promise<Page[]> {
    const ancestors = await this.client.getAncestors(pageId);
    if (ancestors.length === 0) return [];

    const parent = ancestors[ancestors.length - 1];
    const children = await this.client.getChildren(parent.id, { limit: 50 });
    return children.results.filter(p => p.id !== pageId);
  }

  /**
   * Build a page tree with configurable depth and max nodes.
   * Uses BFS to avoid deep recursion.
   */
  async getTree(pageId: string, maxDepth: number = 2, maxNodes: number = 50): Promise<TreeNode> {
    const rootPage = await this.client.getPage(pageId);
    const root: TreeNode = { page: rootPage, depth: 0, children: [] };

    const queue: TreeNode[] = [root];
    let nodeCount = 1;

    while (queue.length > 0 && nodeCount < maxNodes) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      const remaining = maxNodes - nodeCount;
      const children = await this.client.getChildren(current.page.id, { limit: Math.min(remaining, 25) });

      for (const childPage of children.results) {
        if (nodeCount >= maxNodes) break;
        const childNode: TreeNode = {
          page: childPage,
          depth: current.depth + 1,
          children: [],
        };
        current.children.push(childNode);
        queue.push(childNode);
        nodeCount++;
      }
    }

    return root;
  }

  /**
   * Get forward links from a page.
   * Uses GraphQL link graph when available, falls back to ADF body parsing.
   */
  async getForwardLinks(pageId: string): Promise<Array<{ pageId?: string; url: string; text: string }>> {
    // GraphQL path — uses the link graph
    if (this.graphql) {
      const linkedPageIds = await this.graphql.getOutgoingLinks(pageId);
      if (linkedPageIds.length === 0) return [];

      const results = await Promise.allSettled(
        linkedPageIds.map(id => this.client.getPage(id))
      );
      return results.map((r, i) => ({
        pageId: linkedPageIds[i],
        url: '',
        text: r.status === 'fulfilled' ? r.value.title : `(page ${linkedPageIds[i]})`,
      }));
    }

    // Fallback — parse ADF body for link marks
    return this.extractLinksFromAdf(pageId);
  }

  /**
   * Extract links from a page's ADF content body (fallback for when GraphQL is unavailable).
   */
  private async extractLinksFromAdf(pageId: string): Promise<Array<{ pageId?: string; url: string; text: string }>> {
    const page = await this.client.getPage(pageId, ['body']);
    if (!page.body?.atlas_doc_format) return [];

    const links: Array<{ pageId?: string; url: string; text: string }> = [];
    const seen = new Set<string>();

    const walk = (node: AdfNode) => {
      if (node.text && node.marks) {
        for (const mark of node.marks) {
          if (mark.type === 'link' && mark.attrs?.href) {
            const href = mark.attrs.href as string;
            if (seen.has(href)) continue;
            seen.add(href);
            const confluencePageMatch = href.match(/\/pages\/(\d+)/);
            links.push({ pageId: confluencePageMatch?.[1], url: href, text: node.text });
          }
        }
      }

      if (node.type === 'inlineCard' && node.attrs?.url) {
        const href = node.attrs.url as string;
        if (!seen.has(href)) {
          seen.add(href);
          const confluencePageMatch = href.match(/\/pages\/(\d+)/);
          links.push({ pageId: confluencePageMatch?.[1], url: href, text: href });
        }
      }

      if (node.content) {
        for (const child of node.content) { walk(child); }
      }
    };

    walk(page.body.atlas_doc_format as unknown as AdfNode);
    return links;
  }

  /**
   * Find pages that link to this page.
   * Uses GraphQL link graph when available, falls back to CQL text search.
   */
  async getBacklinks(pageId: string): Promise<Page[]> {
    // GraphQL path — uses the link graph (fast, accurate)
    if (this.graphql) {
      const linkedPageIds = await this.graphql.getIncomingLinks(pageId);
      if (linkedPageIds.length === 0) return [];

      // Fetch page details in parallel
      const results = await Promise.allSettled(
        linkedPageIds.map(id => this.client.getPage(id))
      );
      return results
        .filter((r): r is PromiseFulfilledResult<Page> => r.status === 'fulfilled')
        .map(r => r.value);
    }

    // Fallback — CQL text search for the page URL (approximate)
    const page = await this.client.getPage(pageId);
    const cql = `type = page AND text ~ "${escapeCql(page.title)}" AND id != "${escapeCql(pageId)}"`;
    const results = await this.client.searchByCql(cql, { limit: 25 });
    return results.results.map(r => r.content);
  }

  /**
   * Find related pages by shared labels.
   */
  async getRelated(pageId: string): Promise<{ pages: Page[]; sharedLabels: Record<string, string[]> }> {
    const labels = await this.client.getLabels(pageId);
    if (labels.length === 0) {
      return { pages: [], sharedLabels: {} };
    }

    const labelCql = labels.map(l => `"${escapeCql(l)}"`).join(', ');
    const cql = `type = page AND label IN (${labelCql}) AND id != "${escapeCql(pageId)}"`;

    const results = await this.client.searchByCql(cql, { limit: 25 });

    // Track which labels each result shares
    const sharedLabels: Record<string, string[]> = {};
    for (const result of results.results) {
      // We know they share at least one label since the CQL matched
      sharedLabels[result.content.id] = labels; // approximate — CQL doesn't tell us which
    }

    return {
      pages: results.results.map(r => r.content),
      sharedLabels,
    };
  }

  /**
   * Flatten a tree into a list with depth info (for rendering).
   */
  flattenTree(node: TreeNode): Array<{ page: Page; depth: number }> {
    const result: Array<{ page: Page; depth: number }> = [];
    const walk = (n: TreeNode) => {
      result.push({ page: n.page, depth: n.depth });
      for (const child of n.children) {
        walk(child);
      }
    };
    walk(node);
    return result;
  }
}
