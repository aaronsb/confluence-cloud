/**
 * Handler for search_confluence tool.
 */

import type { ConfluenceClient } from '../client/confluence-client.js';
import type { ToolResponse } from '../types/index.js';
import { escapeCql } from '../client/cql-utils.js';
import { renderSearchResults } from '../rendering/markdown-renderer.js';
import { getNextSteps } from '../rendering/next-steps.js';

interface SearchArgs {
  operation: string;
  cql?: string;
  query?: string;
  labels?: string[];
  contributor?: string;
  spaceKey?: string;
  cursor?: string;
  limit?: number;
}

export async function handleSearchRequest(
  client: ConfluenceClient,
  args: SearchArgs,
): Promise<ToolResponse> {
  let cql: string;

  switch (args.operation) {
    case 'cql':
      if (!args.cql) {
        return { content: [{ type: 'text', text: 'cql is required for cql operation' }], isError: true };
      }
      cql = args.cql;
      break;

    case 'fulltext':
      if (!args.query) {
        return { content: [{ type: 'text', text: 'query is required for fulltext operation' }], isError: true };
      }
      cql = `type = page AND text ~ "${escapeCql(args.query)}"`;
      if (args.spaceKey) cql += ` AND space = "${escapeCql(args.spaceKey)}"`;
      break;

    case 'by_label':
      if (!args.labels || args.labels.length === 0) {
        return { content: [{ type: 'text', text: 'labels array is required for by_label operation' }], isError: true };
      }
      cql = `type = page AND label IN (${args.labels.map(l => `"${escapeCql(l)}"`).join(', ')})`;
      if (args.spaceKey) cql += ` AND space = "${escapeCql(args.spaceKey)}"`;
      break;

    case 'by_contributor':
      if (!args.contributor) {
        return { content: [{ type: 'text', text: 'contributor is required for by_contributor operation' }], isError: true };
      }
      cql = `type = page AND contributor = "${escapeCql(args.contributor)}"`;
      if (args.spaceKey) cql += ` AND space = "${escapeCql(args.spaceKey)}"`;
      break;

    case 'recent':
      cql = 'type = page ORDER BY lastmodified DESC';
      if (args.spaceKey) cql = `type = page AND space = "${escapeCql(args.spaceKey)}" ORDER BY lastmodified DESC`;
      break;

    default:
      return { content: [{ type: 'text', text: `Unknown search operation: ${args.operation}` }], isError: true };
  }

  const results = await client.searchByCql(cql, { cursor: args.cursor, limit: args.limit ?? 25 });
  let text = renderSearchResults(results);
  text += getNextSteps('search', { cql });
  return { content: [{ type: 'text', text }] };
}
