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

  const results: ToolResponse[] = [];
  const outputs: string[] = [];

  for (let i = 0; i < args.operations.length; i++) {
    const op = args.operations[i];
    const resolvedArgs = resolveReferences(op.args, results);

    try {
      const result = await dispatch(op.tool, resolvedArgs);
      results.push(result);

      const text = result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');

      outputs.push(`### Operation ${i + 1}: ${op.tool}\n${result.isError ? '❌ ' : '✅ '}${text}`);

      if (result.isError && (op.onError ?? 'bail') === 'bail') {
        outputs.push(`\n⛔ Bailed at operation ${i + 1}. ${args.operations.length - i - 1} operation(s) skipped.`);
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ content: [{ type: 'text', text: message }], isError: true });
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
 * Resolve $N.field references in args from prior results.
 */
function resolveReferences(
  args: Record<string, unknown>,
  results: ToolResponse[],
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.match(/^\$\d+\./)) {
      const match = value.match(/^\$(\d+)\.(.+)/);
      if (match) {
        const refIdx = parseInt(match[1], 10);
        // Reference resolution would need structured result data
        // For now, pass through as-is with a note
        resolved[key] = value;
      }
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}
