import { describe, it, expect } from 'vitest';
import { getNextSteps } from './next-steps.js';

describe('getNextSteps', () => {
  it('should return hints for page_get', () => {
    const text = getNextSteps('page_get', { pageId: '123' });
    expect(text).toContain('Next steps');
    expect(text).toContain('Edit this page');
    expect(text).toContain('"pageId":"123"');
  });

  it('should resolve $param references', () => {
    const text = getNextSteps('page_create', { pageId: '456' });
    expect(text).toContain('"pageId":"456"');
  });

  it('should keep $param literal when not provided', () => {
    const text = getNextSteps('page_get');
    expect(text).toContain('$pageId');
  });

  it('should return empty string for unknown context', () => {
    const text = getNextSteps('unknown_op' as any);
    expect(text).toBe('');
  });

  it('should include correct tool names', () => {
    const text = getNextSteps('search');
    expect(text).toContain('manage_confluence_page');
    expect(text).toContain('search_confluence');
  });
});
