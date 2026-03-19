/**
 * Handler for navigate_confluence tool.
 */

import type { ToolResponse } from '../types/index.js';
import type { NavigationService } from '../navigation/navigation-service.js';
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
  nav: NavigationService,
  args: NavigateArgs,
): Promise<ToolResponse> {

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

    case 'links': {
      const links = await nav.getForwardLinks(args.pageId);
      if (links.length === 0) {
        let text = 'No outgoing links found on this page.';
        text += getNextSteps('navigate', { pageId: args.pageId });
        return { content: [{ type: 'text', text }] };
      }
      const linkLines = links.map(l => {
        const target = l.pageId ? `page:${l.pageId}` : l.url;
        return `  🔗 [${l.text}](${l.url}) → ${target}`;
      });
      let text = `Forward links from ${args.pageId} (${links.length}):\n\n${linkLines.join('\n')}`;
      text += getNextSteps('navigate', { pageId: args.pageId });
      return { content: [{ type: 'text', text }] };
    }

    case 'backlinks': {
      const pages = await nav.getBacklinks(args.pageId);
      if (pages.length === 0) {
        let text = 'No pages link to this page.';
        text += getNextSteps('navigate', { pageId: args.pageId });
        return { content: [{ type: 'text', text }] };
      }
      let text = `Pages linking to ${args.pageId} (${pages.length}):\n\n${renderPageList(pages)}`;
      text += getNextSteps('navigate', { pageId: args.pageId });
      return { content: [{ type: 'text', text }] };
    }

    case 'related': {
      const { pages, sharedLabels } = await nav.getRelated(args.pageId);
      if (pages.length === 0) {
        let text = 'No related pages found (page has no labels, or no other pages share them).';
        text += getNextSteps('navigate', { pageId: args.pageId });
        return { content: [{ type: 'text', text }] };
      }
      let text = `Related pages (by shared labels, ${pages.length} found):\n\n${renderPageList(pages)}`;
      text += getNextSteps('navigate', { pageId: args.pageId });
      return { content: [{ type: 'text', text }] };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown navigation operation: ${args.operation}` }], isError: true };
  }
}
