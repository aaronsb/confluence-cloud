import { describe, it, expect, vi } from 'vitest';
import { handleQueueRequest } from './queue-handler.js';
import type { ToolResponse } from '../types/index.js';

function okResponse(text: string): ToolResponse {
  return { content: [{ type: 'text', text }] };
}

function errorResponse(text: string): ToolResponse {
  return { content: [{ type: 'text', text }], isError: true };
}

describe('handleQueueRequest', () => {
  it('should reject empty operations', async () => {
    const result = await handleQueueRequest(vi.fn(), { operations: [] });
    expect(result.isError).toBe(true);
  });

  it('should reject more than 16 operations', async () => {
    const ops = Array.from({ length: 17 }, () => ({ tool: 'test', args: {} }));
    const result = await handleQueueRequest(vi.fn(), { operations: ops });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Maximum 16');
  });

  it('should execute operations sequentially', async () => {
    const order: number[] = [];
    const dispatch = vi.fn().mockImplementation(async (_tool: string, args: Record<string, unknown>) => {
      order.push(args.n as number);
      return okResponse(`result ${args.n}`);
    });

    await handleQueueRequest(dispatch, {
      operations: [
        { tool: 'a', args: { n: 1 } },
        { tool: 'b', args: { n: 2 } },
        { tool: 'c', args: { n: 3 } },
      ],
    });

    expect(order).toEqual([1, 2, 3]);
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it('should bail on error by default', async () => {
    const dispatch = vi.fn()
      .mockResolvedValueOnce(okResponse('ok'))
      .mockResolvedValueOnce(errorResponse('failed'))
      .mockResolvedValueOnce(okResponse('should not run'));

    const result = await handleQueueRequest(dispatch, {
      operations: [
        { tool: 'a', args: {} },
        { tool: 'b', args: {} },
        { tool: 'c', args: {} },
      ],
    });

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(result.content[0].text).toContain('Bailed at operation 2');
    expect(result.content[0].text).toContain('1 operation(s) skipped');
  });

  it('should continue on error when onError=continue', async () => {
    const dispatch = vi.fn()
      .mockResolvedValueOnce(okResponse('ok'))
      .mockResolvedValueOnce(errorResponse('failed'))
      .mockResolvedValueOnce(okResponse('also ok'));

    const result = await handleQueueRequest(dispatch, {
      operations: [
        { tool: 'a', args: {} },
        { tool: 'b', args: {}, onError: 'continue' },
        { tool: 'c', args: {} },
      ],
    });

    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(result.content[0].text).not.toContain('Bailed');
  });

  it('should handle dispatch exceptions', async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error('network error'));

    const result = await handleQueueRequest(dispatch, {
      operations: [{ tool: 'a', args: {} }],
    });

    expect(result.content[0].text).toContain('network error');
    expect(result.content[0].text).toContain('❌');
  });

  it('should resolve $N.field references from prior results', async () => {
    const dispatch = vi.fn()
      .mockResolvedValueOnce(okResponse('Session: abc-def-123\nVersion: 5'))
      .mockResolvedValueOnce(okResponse('done'));

    await handleQueueRequest(dispatch, {
      operations: [
        { tool: 'manage_confluence_page', args: { operation: 'pull_for_editing', pageId: '999' } },
        { tool: 'edit_confluence_content', args: { sessionHandle: '$0.sessionHandle', operation: 'list_blocks' } },
      ],
    });

    expect(dispatch).toHaveBeenCalledTimes(2);
    const secondCall = dispatch.mock.calls[1];
    expect(secondCall[1].sessionHandle).toBe('abc-def-123');
  });

  it('should carry forward pageId from input args', async () => {
    const dispatch = vi.fn()
      .mockResolvedValueOnce(okResponse('got page'))
      .mockResolvedValueOnce(okResponse('navigated'));

    await handleQueueRequest(dispatch, {
      operations: [
        { tool: 'manage_confluence_page', args: { operation: 'get', pageId: '777' } },
        { tool: 'navigate_confluence', args: { operation: 'children', pageId: '$0.pageId' } },
      ],
    });

    const secondCall = dispatch.mock.calls[1];
    expect(secondCall[1].pageId).toBe('777');
  });

  it('should pass through unresolvable references', async () => {
    const dispatch = vi.fn().mockResolvedValue(okResponse('ok'));

    await handleQueueRequest(dispatch, {
      operations: [
        { tool: 'a', args: {} },
        { tool: 'b', args: { ref: '$0.nonexistent' } },
      ],
    });

    const secondCall = dispatch.mock.calls[1];
    expect(secondCall[1].ref).toBe('$0.nonexistent');
  });
});
