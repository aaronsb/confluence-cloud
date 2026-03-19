/**
 * Handler for navigate_confluence tool.
 */

import type { ConfluenceClient } from '../client/confluence-client.js';
import type { ToolResponse } from '../types/index.js';
import { NavigationService } from '../navigation/navigation-service.js';
import { renderPageList, renderTree } from '../rendering/markdown-renderer.js';
import { getNextSteps } from '../rendering/next-steps.js';

interface NavigateArgs {
  operation: string;
  pageId: string;
  depth?: number;
  maxNodes?: number;
  expand?: string[];
}

export async function handleNavigateRequest(
  client: ConfluenceClient,
  args: NavigateArgs,
): Promise<ToolResponse> {
  const nav = new NavigationService(client);

  switch (args.operation) {
    case 'children': {
      const children = await nav.getChildren(args.pageId);
      let text = `Children of ${args.pageId}:\n\n${renderPageList(children)}`;
      text += getNextSteps('navigate', { pageId: args.pageId });
      return { content: [{ type: 'text', text }] };
    }

    case 'ancestors': {
      const ancestors = await nav.getAncestors(args.pageId);
      const path = ancestors.map(p => p.title).join(' → ');
      let text = `Path to root: ${path || '(root page)'}`;
      text += getNextSteps('navigate', { pageId: args.pageId });
      return { content: [{ type: 'text', text }] };
    }

    case 'siblings': {
      const siblings = await nav.getSiblings(args.pageId);
      let text = `Siblings of ${args.pageId}:\n\n${renderPageList(siblings)}`;
      text += getNextSteps('navigate', { pageId: args.pageId });
      return { content: [{ type: 'text', text }] };
    }

    case 'tree': {
      const tree = await nav.getTree(args.pageId, args.depth ?? 2, args.maxNodes ?? 50);
      const flat = nav.flattenTree(tree);
      let text = renderTree(flat);
      text += getNextSteps('navigate', { pageId: args.pageId });
      return { content: [{ type: 'text', text }] };
    }

    case 'links':
    case 'backlinks':
    case 'related':
      return { content: [{ type: 'text', text: `Operation '${args.operation}' is not yet implemented.` }] };

    default:
      return { content: [{ type: 'text', text: `Unknown navigation operation: ${args.operation}` }], isError: true };
  }
}
