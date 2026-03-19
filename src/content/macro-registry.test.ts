import { describe, it, expect } from 'vitest';
import { MacroRegistry } from './macro-registry.js';

describe('MacroRegistry', () => {
  const registry = new MacroRegistry();

  it('should have built-in macros', () => {
    expect(registry.all().length).toBeGreaterThan(0);
    expect(registry.has('status')).toBe(true);
    expect(registry.has('info')).toBe(true);
    expect(registry.has('expand')).toBe(true);
    expect(registry.has('toc')).toBe(true);
    expect(registry.has('jira')).toBe(true);
  });

  it('should return undefined for unknown macros', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should validate required params', () => {
    const errors = registry.validate('status', {});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.param === 'color')).toBe(true);
    expect(errors.some(e => e.param === 'title')).toBe(true);
  });

  it('should pass valid params', () => {
    const errors = registry.validate('status', { color: 'green', title: 'Done' });
    expect(errors).toHaveLength(0);
  });

  it('should reject invalid enum values', () => {
    const errors = registry.validate('status', { color: 'purple', title: 'Done' });
    expect(errors).toHaveLength(1);
    expect(errors[0].param).toBe('color');
    expect(errors[0].message).toContain('purple');
  });

  it('should validate number params', () => {
    const errors = registry.validate('toc', { maxLevel: 'abc' });
    expect(errors).toHaveLength(1);
    expect(errors[0].param).toBe('maxLevel');
  });

  it('should accept valid number params', () => {
    const errors = registry.validate('toc', { maxLevel: '3' });
    expect(errors).toHaveLength(0);
  });

  it('should skip validation for unknown macros', () => {
    const errors = registry.validate('custom-unknown', { anything: 'goes' });
    expect(errors).toHaveLength(0);
  });

  it('should filter by category', () => {
    const formatting = registry.byCategory('formatting');
    expect(formatting.length).toBeGreaterThan(0);
    expect(formatting.every(m => m.category === 'formatting')).toBe(true);
  });

  it('should allow registering custom macros', () => {
    registry.register({
      key: 'custom-test',
      name: 'Custom Test',
      category: 'content',
      params: [{ name: 'value', type: 'string', required: true }],
      hasBody: false,
      renderHint: ':::custom-test{value="..."}:::',
    });
    expect(registry.has('custom-test')).toBe(true);
    const errors = registry.validate('custom-test', {});
    expect(errors).toHaveLength(1);
  });
});
