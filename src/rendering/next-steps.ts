/**
 * Context-aware semantic next-step hints.
 * See ADR-500: Rendering Facades and Semantic Hinting.
 */

export type OperationContext =
  | 'page_get'
  | 'page_create'
  | 'page_update'
  | 'page_delete'
  | 'page_move'
  | 'page_copy'
  | 'page_archive'
  | 'page_unarchive'
  | 'space_list'
  | 'space_get'
  | 'search'
  | 'navigate'
  | 'scratchpad_submit'
  | 'media_list'
  | 'media_upload';

interface NextStepHint {
  description: string;
  tool: string;
  example: Record<string, unknown>;
}

export function getNextSteps(context: OperationContext, params?: Record<string, string>): string {
  const hints = HINTS[context] ?? [];
  if (hints.length === 0) return '';

  const resolvedHints = hints.map(hint => {
    const example = resolveParams(hint.example, params ?? {});
    return `- ${hint.description}: \`${hint.tool}\` — \`${JSON.stringify(example)}\``;
  });

  return `\n---\n**Next steps:**\n${resolvedHints.join('\n')}`;
}

function resolveParams(
  example: Record<string, unknown>,
  params: Record<string, string>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(example)) {
    if (typeof value === 'string' && value.startsWith('$')) {
      const paramName = value.slice(1);
      resolved[key] = params[paramName] ?? value;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

// ── Hint Definitions ───────────────────────────────────────────

const HINTS: Record<OperationContext, NextStepHint[]> = {
  page_get: [
    {
      description: 'Edit this page',
      tool: 'manage_confluence_page',
      example: { operation: 'pull_for_editing', pageId: '$pageId' },
    },
    {
      description: 'View child pages',
      tool: 'navigate_confluence',
      example: { operation: 'children', pageId: '$pageId' },
    },
    {
      description: 'Find pages linking here',
      tool: 'navigate_confluence',
      example: { operation: 'backlinks', pageId: '$pageId' },
    },
  ],

  page_create: [
    {
      description: 'View the page',
      tool: 'manage_confluence_page',
      example: { operation: 'get', pageId: '$pageId' },
    },
    {
      description: 'Edit this page',
      tool: 'manage_confluence_page',
      example: { operation: 'pull_for_editing', pageId: '$pageId' },
    },
  ],

  page_update: [
    {
      description: 'View the updated page',
      tool: 'manage_confluence_page',
      example: { operation: 'get', pageId: '$pageId' },
    },
    {
      description: 'Check what links to this page',
      tool: 'navigate_confluence',
      example: { operation: 'backlinks', pageId: '$pageId' },
    },
  ],

  page_delete: [
    {
      description: 'List pages in this space',
      tool: 'search_confluence',
      example: { operation: 'cql', cql: 'space = "$spaceKey"' },
    },
  ],

  space_list: [
    {
      description: 'View a specific space',
      tool: 'manage_confluence_space',
      example: { operation: 'get', spaceId: '$spaceId' },
    },
    {
      description: 'Search within a space',
      tool: 'search_confluence',
      example: { operation: 'cql', cql: 'space = "KEY" AND type = page' },
    },
  ],

  space_get: [
    {
      description: 'Browse pages in this space',
      tool: 'search_confluence',
      example: { operation: 'cql', cql: 'space = "$spaceKey" AND type = page ORDER BY lastmodified DESC' },
    },
    {
      description: 'View page tree',
      tool: 'navigate_confluence',
      example: { operation: 'tree', pageId: '$homepageId', depth: 2 },
    },
  ],

  search: [
    {
      description: 'View a specific result',
      tool: 'manage_confluence_page',
      example: { operation: 'get', pageId: '$pageId' },
    },
    {
      description: 'Refine your search',
      tool: 'search_confluence',
      example: { operation: 'cql', cql: '$cql AND label = "tag"' },
    },
  ],

  navigate: [
    {
      description: 'View a page',
      tool: 'manage_confluence_page',
      example: { operation: 'get', pageId: '$pageId' },
    },
    {
      description: 'Edit a page',
      tool: 'manage_confluence_page',
      example: { operation: 'pull_for_editing', pageId: '$pageId' },
    },
  ],

  scratchpad_submit: [
    {
      description: 'View the updated page',
      tool: 'manage_confluence_page',
      example: { operation: 'get', pageId: '$pageId' },
    },
    {
      description: 'Check backlinks for impact',
      tool: 'navigate_confluence',
      example: { operation: 'backlinks', pageId: '$pageId' },
    },
  ],

  media_list: [
    {
      description: 'Upload a new attachment',
      tool: 'manage_confluence_media',
      example: { operation: 'upload', pageId: '$pageId' },
    },
  ],

  media_upload: [
    {
      description: 'View all attachments',
      tool: 'manage_confluence_media',
      example: { operation: 'list', pageId: '$pageId' },
    },
  ],

  page_move: [
    {
      description: 'View the moved page',
      tool: 'manage_confluence_page',
      example: { operation: 'get', pageId: '$pageId' },
    },
    {
      description: 'See it in context',
      tool: 'navigate_confluence',
      example: { operation: 'tree', pageId: '$pageId', depth: 2 },
    },
  ],

  page_copy: [
    {
      description: 'View the copy',
      tool: 'manage_confluence_page',
      example: { operation: 'get', pageId: '$pageId' },
    },
    {
      description: 'Edit the copy',
      tool: 'manage_confluence_page',
      example: { operation: 'pull_for_editing', pageId: '$pageId' },
    },
  ],

  page_archive: [
    {
      description: 'List archived pages in this space',
      tool: 'manage_confluence_page',
      example: { operation: 'list_archived', spaceKey: '$spaceKey' },
    },
    {
      description: 'Restore this page',
      tool: 'manage_confluence_page',
      example: { operation: 'unarchive', pageId: '$pageId' },
    },
  ],

  page_unarchive: [
    {
      description: 'View the restored page',
      tool: 'manage_confluence_page',
      example: { operation: 'get', pageId: '$pageId' },
    },
    {
      description: 'Edit the restored page',
      tool: 'manage_confluence_page',
      example: { operation: 'pull_for_editing', pageId: '$pageId' },
    },
  ],
};
