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
    description: 'Get, create, update, delete, move, copy, archive, or pull pages for editing. Manage labels and content properties. Create returns a scratchpad for composing content before publishing. Use pull_for_editing to load existing page content into a scratchpad. Archive/unarchive pages or entire page trees.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['get', 'create', 'update', 'delete', 'move', 'copy', 'get_versions', 'pull_for_editing', 'get_labels', 'add_labels', 'remove_label', 'get_properties', 'get_property', 'set_property', 'delete_property', 'archive', 'archive_tree', 'unarchive', 'list_archived'],
          description: 'The operation to perform',
        },
        pageId: {
          type: 'string',
          description: 'Page ID (required for get, update, delete, move, copy, get_versions, pull_for_editing, archive, archive_tree, unarchive)',
        },
        spaceId: {
          type: 'string',
          description: 'Space ID (required for create, usable for list_archived)',
        },
        spaceKey: {
          type: 'string',
          description: 'Space key (for list_archived)',
        },
        title: {
          type: 'string',
          description: 'Page title (required for create, optional for update)',
        },
        parentId: {
          type: 'string',
          description: 'Parent page ID (optional for create, required for move, optional for copy)',
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
    description: 'Line-addressed content editing within a scratchpad buffer. View, insert, replace, or remove lines, then submit to Confluence. Requires a scratchpadId from create or pull_for_editing.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['view', 'insert_lines', 'append_lines', 'replace_lines', 'remove_lines', 'submit', 'discard', 'list'],
          description: 'The editing operation to perform',
        },
        scratchpadId: {
          type: 'string',
          description: 'Scratchpad ID from create or pull_for_editing (required for all ops except list)',
        },
        afterLine: {
          type: 'number',
          description: 'Line number to insert after (0 = prepend). For insert_lines.',
        },
        startLine: {
          type: 'number',
          description: 'Start of line range (1-based). For view, replace_lines, remove_lines.',
        },
        endLine: {
          type: 'number',
          description: 'End of line range (1-based, inclusive). For view, replace_lines, remove_lines.',
        },
        content: {
          type: 'string',
          description: 'Text content (newlines create multiple lines). For insert_lines, append_lines, replace_lines.',
        },
        message: {
          type: 'string',
          description: 'Version message for submit operation',
        },
      },
      required: ['operation'],
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
    description: 'Upload, download, list, view, or delete page attachments and media. Use view to display images inline.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['upload', 'download', 'list', 'delete', 'get_info', 'view'],
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
          description: 'Base64-encoded file content for upload (or use workspaceFile instead)',
        },
        mediaType: {
          type: 'string',
          description: 'MIME type for upload (e.g., image/png)',
        },
        workspaceFile: {
          type: 'string',
          description: 'Read file from workspace instead of base64 content (alternative to content for upload)',
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

  manage_workspace: {
    name: 'manage_workspace',
    description: 'Stage files in the local workspace for attachment operations. List, read, write, delete files, or create directories. Supports nested paths (e.g. "projects/images/photo.png"). Downloaded attachments land here; upload can read from here. All responses include the absolute filesystem path.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['list', 'read', 'write', 'delete', 'mkdir', 'move'],
          description: 'The workspace operation to perform',
        },
        filename: {
          type: 'string',
          description: 'File or directory path, supports nesting with / separators (required for read, write, delete, mkdir, move)',
        },
        destination: {
          type: 'string',
          description: 'Destination path for move operation — works like unix mv: rename a file (move filename:"old.txt" destination:"new.txt"), relocate it (move filename:"file.txt" destination:"subdir/file.txt"), or both at once',
        },
        content: {
          type: 'string',
          description: 'Base64-encoded file content (required for write)',
        },
      },
      required: ['operation'],
    },
  },
};
