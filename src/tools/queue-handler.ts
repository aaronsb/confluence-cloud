/**
 * Handler for queue_confluence_operations tool.
 * Executes multiple operations sequentially with result references.
 */

import type { ToolResponse } from '../types/index.js';

interface QueueArgs {
  operations: Array<{
    tool: string;
    args: Record<string, unknown>;
    onError?: 'bail' | 'continue';
  }>;
}

type ToolDispatcher = (toolName: string, args: Record<string, unknown>) => Promise<ToolResponse>;

export async function handleQueueRequest(
  dispatch: ToolDispatcher,
  args: QueueArgs,
): Promise<ToolResponse> {
  if (!args.operations || args.operations.length === 0) {
    return { content: [{ type: 'text', text: 'operations array is required and must not be empty' }], isError: true };
  }

  if (args.operations.length > 16) {
    return { content: [{ type: 'text', text: 'Maximum 16 operations per queue' }], isError: true };
  }

  const resultMetadata: Array<Record<string, string>> = [];
  const outputs: string[] = [];

  for (let i = 0; i < args.operations.length; i++) {
    const op = args.operations[i];
    const resolvedArgs = resolveReferences(op.args, resultMetadata);

    try {
      const result = await dispatch(op.tool, resolvedArgs);

      const text = result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');

      // Extract metadata from the result for future $N.field references
      resultMetadata.push(extractMetadata(text, resolvedArgs));

      outputs.push(`### Operation ${i + 1}: ${op.tool}\n${result.isError ? '❌ ' : '✅ '}${text}`);

      if (result.isError && (op.onError ?? 'bail') === 'bail') {
        outputs.push(`\n⛔ Bailed at operation ${i + 1}. ${args.operations.length - i - 1} operation(s) skipped.`);
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resultMetadata.push({});
      outputs.push(`### Operation ${i + 1}: ${op.tool}\n❌ Error: ${message}`);

      if ((op.onError ?? 'bail') === 'bail') {
        outputs.push(`\n⛔ Bailed at operation ${i + 1}. ${args.operations.length - i - 1} operation(s) skipped.`);
        break;
      }
    }
  }

  return {
    content: [{ type: 'text', text: outputs.join('\n\n') }],
  };
}

/**
 * Resolve $N.field references in args from prior result metadata.
 */
function resolveReferences(
  args: Record<string, unknown>,
  metadata: Array<Record<string, string>>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.match(/^\$\d+\./)) {
      const match = value.match(/^\$(\d+)\.(.+)/);
      if (match) {
        const refIdx = parseInt(match[1], 10);
        const field = match[2];
        if (refIdx >= 0 && refIdx < metadata.length && metadata[refIdx][field]) {
          resolved[key] = metadata[refIdx][field];
        } else {
          resolved[key] = value; // Unresolvable — pass through
        }
      } else {
        resolved[key] = value;
      }
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * Extract common metadata fields from result text and input args.
 * Looks for IDs, keys, and handles that downstream operations reference.
 */
function extractMetadata(text: string, args: Record<string, unknown>): Record<string, string> {
  const meta: Record<string, string> = {};

  // Carry forward input args that are common reference targets
  if (typeof args.pageId === 'string') meta.pageId = args.pageId;
  if (typeof args.spaceId === 'string') meta.spaceId = args.spaceId;
  if (typeof args.spaceKey === 'string') meta.spaceKey = args.spaceKey;
  if (typeof args.attachmentId === 'string') meta.attachmentId = args.attachmentId;

  // Extract scratchpad ID from create or pull_for_editing output
  const scratchpadMatch = text.match(/Scratchpad:\s*(sp-[a-f0-9-]+)/);
  if (scratchpadMatch) meta.scratchpadId = scratchpadMatch[1];

  // Extract page ID from various output patterns
  const pageIdMatch = text.match(/(?:pageId|Page ID)["\s:]+([0-9]+)/);
  if (pageIdMatch) meta.pageId = pageIdMatch[1];

  // Extract version number
  const versionMatch = text.match(/Version:\s*(\d+)/);
  if (versionMatch) meta.version = versionMatch[1];

  return meta;
}
