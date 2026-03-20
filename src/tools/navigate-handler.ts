/**
 * Handler for navigate_confluence tool.
 */

import type { ConfluenceClient } from '../client/confluence-client.js';
import type { GraphQLClient } from '../client/graphql-client.js';
import type { NavigationService } from '../navigation/navigation-service.js';
import { renderPageList, renderTree } from '../rendering/markdown-renderer.js';
import { getNextSteps } from '../rendering/next-steps.js';
import type { ToolResponse } from '../types/index.js';

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
  graphql?: GraphQLClient | null,
  client?: ConfluenceClient | null,
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
      const { pages } = await nav.getRelated(args.pageId);
      if (pages.length === 0) {
        let text = 'No related pages found (page has no labels, or no other pages share them).';
        text += getNextSteps('navigate', { pageId: args.pageId });
        return { content: [{ type: 'text', text }] };
      }
      let text = `Related pages (by shared labels, ${pages.length} found):\n\n${renderPageList(pages)}`;
      text += getNextSteps('navigate', { pageId: args.pageId });
      return { content: [{ type: 'text', text }] };
    }

    case 'discover_metadata': {
      return handleDiscoverMetadata(graphql, client, args.pageId);
    }

    default:
      return { content: [{ type: 'text', text: `Unknown navigation operation: ${args.operation}` }], isError: true };
  }
}

async function handleDiscoverMetadata(
  graphql: GraphQLClient | null | undefined,
  client: ConfluenceClient | null | undefined,
  pageId?: string,
): Promise<ToolResponse> {
  if (!graphql) {
    return {
      content: [{
        type: 'text',
        text: [
          'Metadata discovery requires GraphQL (not available for this instance).',
          '',
          'Known metadata operations available via `manage_confluence_page`:',
          '- `get_labels` / `add_labels` / `remove_label` — page labels',
          '- `get_properties` / `get_property` / `set_property` / `delete_property` — content properties',
        ].join('\n'),
      }],
    };
  }

  // Introspect the ConfluencePage type to discover available metadata fields
  const introspection = await graphql.query<{
    __type: {
      fields: Array<{
        name: string;
        description: string | null;
        type: { name: string | null; kind: string; ofType?: { name: string | null; kind: string } };
      }>;
    };
  }>(`query IntrospectConfluencePage {
    __type(name: "ConfluencePage") {
      fields {
        name
        description
        type { name kind ofType { name kind } }
      }
    }
  }`);

  if (!introspection.success || !introspection.data?.__type) {
    return {
      content: [{
        type: 'text',
        text: 'Could not introspect ConfluencePage type. ' + (introspection.error ?? ''),
      }],
      isError: true,
    };
  }

  const fields = introspection.data.__type.fields;

  // Categorize discovered fields
  const builtIn = ['id', 'title', 'status', 'version', 'space', 'body', 'labels', 'properties'];
  const relationships = ['ancestors', 'children', 'parent', 'links', 'backlinks'];

  const categorized = {
    builtInMetadata: fields.filter(f => builtIn.some(b => f.name.toLowerCase().includes(b))),
    relationships: fields.filter(f => relationships.some(r => f.name.toLowerCase().includes(r))),
    extended: fields.filter(f =>
      !builtIn.some(b => f.name.toLowerCase().includes(b)) &&
      !relationships.some(r => f.name.toLowerCase().includes(r))
    ),
  };

  const lines: string[] = [
    `Discovered ${fields.length} fields on ConfluencePage:`,
    '',
    '## Built-in Metadata',
    ...categorized.builtInMetadata.map(f => `- **${f.name}** (${formatType(f.type)})${f.description ? ` — ${f.description}` : ''}`),
    '',
    '## Relationships',
    ...categorized.relationships.map(f => `- **${f.name}** (${formatType(f.type)})${f.description ? ` — ${f.description}` : ''}`),
    '',
    '## Extended',
    ...categorized.extended.map(f => `- **${f.name}** (${formatType(f.type)})${f.description ? ` — ${f.description}` : ''}`),
    '',
    '---',
    '**First-class operations available:**',
    '- Labels: `get_labels`, `add_labels`, `remove_label`',
    '- Properties: `get_properties`, `get_property`, `set_property`, `delete_property`',
  ];

  // If pageId provided and client available, fetch actual metadata for this page
  if (pageId && client) {
    lines.push('');
    lines.push(`## Page ${pageId} — Current Metadata`);
    lines.push('');
    try {
      const labels = await client.getLabels(pageId);
      lines.push(`**Labels:** ${labels.length > 0 ? labels.join(', ') : '(none)'}`);
    } catch {
      lines.push('**Labels:** (could not fetch)');
    }
    try {
      const props = await client.getProperties(pageId);
      if (props.length > 0) {
        lines.push('');
        lines.push('**Content Properties:**');
        lines.push('');
        lines.push('| Key | Value | Version |');
        lines.push('|-----|-------|---------|');
        for (const p of props) {
          lines.push(`| ${p.key} | ${JSON.stringify(p.value)} | v${p.version.number} |`);
        }
      } else {
        lines.push('**Content Properties:** (none)');
      }
    } catch {
      lines.push('**Content Properties:** (could not fetch)');
    }
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

function formatType(type: { name: string | null; kind: string; ofType?: { name: string | null; kind: string } }): string {
  if (type.name) return type.name;
  if (type.ofType?.name) return `${type.kind === 'NON_NULL' ? '' : ''}${type.ofType.name}${type.kind === 'LIST' ? '[]' : ''}`;
  return type.kind;
}
