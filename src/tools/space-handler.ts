/**
 * Handler for manage_confluence_space tool.
 */

import type { ConfluenceClient } from '../client/confluence-client.js';
import type { ToolResponse } from '../types/index.js';
import { renderSpace, renderSpaceList } from '../rendering/markdown-renderer.js';
import { getNextSteps } from '../rendering/next-steps.js';

interface SpaceArgs {
  operation: string;
  spaceId?: string;
  spaceKey?: string;
  name?: string;
  cursor?: string;
  limit?: number;
}

export async function handleSpaceRequest(
  client: ConfluenceClient,
  args: SpaceArgs,
): Promise<ToolResponse> {
  switch (args.operation) {
    case 'list': {
      const result = await client.listSpaces({ cursor: args.cursor, limit: args.limit ?? 25 });
      let text = renderSpaceList(result.results);
      if (result.cursor) {
        text += `\n\nMore results available. Use cursor: "${result.cursor}"`;
      }
      text += getNextSteps('space_list');
      return { content: [{ type: 'text', text }] };
    }

    case 'get': {
      if (!args.spaceId) {
        return { content: [{ type: 'text', text: 'spaceId is required for get operation' }], isError: true };
      }
      const space = await client.getSpace(args.spaceId);
      let text = renderSpace(space);
      text += getNextSteps('space_get', { spaceKey: space.key, homepageId: space.homepageId ?? '' });
      return { content: [{ type: 'text', text }] };
    }

    case 'create':
    case 'update':
    case 'get_permissions':
      return { content: [{ type: 'text', text: `Operation '${args.operation}' is not yet implemented.` }] };

    default:
      return { content: [{ type: 'text', text: `Unknown operation: ${args.operation}` }], isError: true };
  }
}
