/**
 * Navigation service — traverses page hierarchy and relationships.
 * See ADR-400: Graph-Native Page Navigation.
 */

import type { ConfluenceClient } from '../client/confluence-client.js';
import type { Page } from '../types/index.js';

export interface TreeNode {
  page: Page;
  depth: number;
  children: TreeNode[];
}

export class NavigationService {
  constructor(private client: ConfluenceClient) {}

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
