/**
 * MCP tool schema definitions.
 * See ADR-101: Operation-Dispatch Tool Surface.
 */

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const toolSchemas: Record<string, ToolSchema> = {
  manage_confluence_page: {
    name: 'manage_confluence_page',
    description: 'Get, create, update, delete, move, copy, or pull pages for editing. Manage labels and content properties. Use pull_for_editing to start a content editing session.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['get', 'create', 'update', 'delete', 'move', 'copy', 'get_versions', 'pull_for_editing', 'get_labels', 'add_labels', 'remove_label', 'get_properties', 'get_property', 'set_property', 'delete_property'],
          description: 'The operation to perform',
        },
        pageId: {
          type: 'string',
          description: 'Page ID (required for get, update, delete, move, copy, get_versions, pull_for_editing)',
        },
        spaceId: {
          type: 'string',
          description: 'Space ID (required for create)',
        },
        title: {
          type: 'string',
          description: 'Page title (required for create, optional for update)',
        },
        parentId: {
          type: 'string',
          description: 'Parent page ID (optional for create/move)',
        },
        expand: {
          type: 'array',
          items: { type: 'string', enum: ['body', 'labels', 'history', 'restrictions'] },
          description: 'Additional data to include in the response',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels to add (for add_labels operation)',
        },
        label: {
          type: 'string',
          description: 'Label to remove (for remove_label operation)',
        },
        propertyKey: {
          type: 'string',
          description: 'Content property key (for get_property, set_property, delete_property)',
        },
        propertyValue: {
          type: 'object',
          description: 'Content property value as JSON object (for set_property)',
        },
      },
      required: ['operation'],
    },
  },

  edit_confluence_content: {
    name: 'edit_confluence_content',
    description: 'Structural content editing within an active editing session. Operates on blocks (sections, paragraphs, macros, tables). Requires a sessionHandle from pull_for_editing.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['patch_section', 'patch_block', 'append', 'replace', 'window_edit', 'list_blocks', 'sync', 'close'],
          description: 'The editing operation to perform',
        },
        sessionHandle: {
          type: 'string',
          description: 'Session handle from pull_for_editing (required for all operations)',
        },
        blockId: {
          type: 'string',
          description: 'Target block ID (required for patch_block, replace)',
        },
        section: {
          type: 'string',
          description: 'Target section heading (for patch_section)',
        },
        content: {
          type: 'string',
          description: 'New content in markdown with ::: directives for macros',
        },
        position: {
          type: 'number',
          description: 'Block position for insert operations',
        },
        searchText: {
          type: 'string',
          description: 'Text to find (for window_edit)',
        },
        replaceText: {
          type: 'string',
          description: 'Replacement text (for window_edit)',
        },
        message: {
          type: 'string',
          description: 'Version message for sync operation',
        },
      },
      required: ['operation', 'sessionHandle'],
    },
  },

  manage_confluence_space: {
    name: 'manage_confluence_space',
    description: 'List spaces, get space details, or manage space configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'get_permissions'],
          description: 'The operation to perform',
        },
        spaceId: {
          type: 'string',
          description: 'Space ID (required for get, update, get_permissions)',
        },
        spaceKey: {
          type: 'string',
          description: 'Space key (required for create)',
        },
        name: {
          type: 'string',
          description: 'Space name (required for create)',
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor',
        },
        limit: {
          type: 'number',
          description: 'Results per page (default 25, max 250)',
        },
      },
      required: ['operation'],
    },
  },

  search_confluence: {
    name: 'search_confluence',
    description: 'Search Confluence using CQL (Confluence Query Language), full-text search, or filter by labels/contributors.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['cql', 'fulltext', 'by_label', 'by_contributor', 'recent'],
          description: 'Search operation type',
        },
        cql: {
          type: 'string',
          description: 'CQL query string (for cql operation)',
        },
        query: {
          type: 'string',
          description: 'Search text (for fulltext operation)',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels to filter by (for by_label)',
        },
        contributor: {
          type: 'string',
          description: 'User ID or email (for by_contributor)',
        },
        spaceKey: {
          type: 'string',
          description: 'Limit search to a specific space',
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor',
        },
        limit: {
          type: 'number',
          description: 'Results per page (default 25, max 100)',
        },
      },
      required: ['operation'],
    },
  },

  manage_confluence_media: {
    name: 'manage_confluence_media',
    description: 'Upload, download, list, or delete page attachments and media.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['upload', 'download', 'list', 'delete', 'get_info'],
          description: 'The media operation to perform',
        },
        pageId: {
          type: 'string',
          description: 'Page ID (required for upload, list)',
        },
        attachmentId: {
          type: 'string',
          description: 'Attachment ID (required for download, delete, get_info)',
        },
        filename: {
          type: 'string',
          description: 'Filename for upload',
        },
        content: {
          type: 'string',
          description: 'Base64-encoded file content for upload',
        },
        mediaType: {
          type: 'string',
          description: 'MIME type for upload (e.g., image/png)',
        },
      },
      required: ['operation'],
    },
  },

  navigate_confluence: {
    name: 'navigate_confluence',
    description: 'Navigate page hierarchy, discover links, backlinks, and related pages. Returns tree views and relationship graphs.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['children', 'ancestors', 'siblings', 'links', 'backlinks', 'tree', 'related', 'discover_metadata'],
          description: 'Navigation operation',
        },
        pageId: {
          type: 'string',
          description: 'Page ID to navigate from (required)',
        },
        depth: {
          type: 'number',
          description: 'Tree depth (for tree operation, default 2, max 5)',
        },
        maxNodes: {
          type: 'number',
          description: 'Maximum nodes to return (for tree, default 50)',
        },
        expand: {
          type: 'array',
          items: { type: 'string', enum: ['excerpt', 'labels', 'metadata'] },
          description: 'Additional data to include per page',
        },
      },
      required: ['operation', 'pageId'],
    },
  },

  queue_confluence_operations: {
    name: 'queue_confluence_operations',
    description: 'Batch multiple Confluence operations in a single call. Supports result references ($0.pageId) and per-operation error strategies.',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tool: {
                type: 'string',
                description: 'Tool name to call',
              },
              args: {
                type: 'object',
                description: 'Arguments for the tool (supports $N.field references to prior results)',
              },
              onError: {
                type: 'string',
                enum: ['bail', 'continue'],
                description: 'Error strategy (default: bail)',
              },
            },
            required: ['tool', 'args'],
          },
          description: 'Array of operations to execute sequentially (1-16)',
          minItems: 1,
          maxItems: 16,
        },
      },
      required: ['operations'],
    },
  },
};
