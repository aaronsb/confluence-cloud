import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScratchpadManager } from './scratchpad.js';
import type { ScratchpadTarget } from './scratchpad.js';

describe('ScratchpadManager', () => {
  let manager: ScratchpadManager;
  const newPageTarget: ScratchpadTarget = {
    type: 'new_page',
    spaceId: 'SPACE1',
    title: 'Test Page',
  };
  const existingPageTarget: ScratchpadTarget = {
    type: 'existing_page',
    pageId: '12345',
    version: 3,
    title: 'Existing Page',
  };

  beforeEach(() => {
    manager = new ScratchpadManager();
  });

  // ── Creation ────────────────────────────────────────────

  describe('createEmpty', () => {
    it('should return a scratchpad ID starting with sp-', () => {
      const id = manager.createEmpty(newPageTarget);
      expect(id).toMatch(/^sp-/);
    });

    it('should create an empty buffer', () => {
      const id = manager.createEmpty(newPageTarget);
      expect(manager.getContent(id)).toBe('');
    });
  });

  describe('createFromLines', () => {
    it('should load content into the buffer', () => {
      const id = manager.createFromLines(existingPageTarget, ['line 1', 'line 2', 'line 3']);
      expect(manager.getContent(id)).toBe('line 1\nline 2\nline 3');
    });

    it('should store the side-table', () => {
      const sideTable = new Map<string, object>([['abc123', { type: 'custom' }]]);
      const id = manager.createFromLines(existingPageTarget, ['test'], sideTable);
      const table = manager.getRawAdfSideTable(id);
      expect(table?.get('abc123')).toEqual({ type: 'custom' });
    });

    it('should copy lines and side-table (no mutation of originals)', () => {
      const lines = ['original'];
      const sideTable = new Map<string, object>([['k', { v: 1 }]]);
      const id = manager.createFromLines(newPageTarget, lines, sideTable);
      lines.push('mutated');
      sideTable.set('k2', { v: 2 });
      expect(manager.getContent(id)).toBe('original');
      expect(manager.getRawAdfSideTable(id)?.has('k2')).toBe(false);
    });
  });

  // ── View ────────────────────────────────────────────────

  describe('view', () => {
    it('should return numbered lines with validation status', () => {
      const id = manager.createFromLines(newPageTarget, ['Hello world', '', '## Section']);
      const view = manager.view(id);
      expect(view).toContain('1 | Hello world');
      expect(view).toContain('2 | ');
      expect(view).toContain('3 | ## Section');
      expect(view).toContain('Status: valid');
    });

    it('should support windowed view', () => {
      const id = manager.createFromLines(newPageTarget, ['a', 'b', 'c', 'd', 'e']);
      const view = manager.view(id, 2, 4);
      expect(view).toContain('2 | b');
      expect(view).toContain('3 | c');
      expect(view).toContain('4 | d');
      expect(view).not.toContain('1 | a');
      expect(view).not.toContain('5 | e');
    });

    it('should show empty buffer message', () => {
      const id = manager.createEmpty(newPageTarget);
      const view = manager.view(id);
      expect(view).toContain('(empty buffer)');
      expect(view).toContain('Status: empty');
    });

    it('should return null for unknown ID', () => {
      expect(manager.view('sp-nonexistent')).toBeNull();
    });

    it('should clamp window to buffer bounds', () => {
      const id = manager.createFromLines(newPageTarget, ['a', 'b']);
      const view = manager.view(id, 0, 100);
      expect(view).toContain('1 | a');
      expect(view).toContain('2 | b');
    });
  });

  // ── Insert Lines ────────────────────────────────────────

  describe('insertLines', () => {
    it('should insert after a given line', () => {
      const id = manager.createFromLines(newPageTarget, ['first', 'third']);
      const result = manager.insertLines(id, 1, 'second');
      expect(result?.message).toContain('Inserted 1 line(s) after line 1');
      expect(manager.getContent(id)).toBe('first\nsecond\nthird');
    });

    it('should prepend when afterLine is 0', () => {
      const id = manager.createFromLines(newPageTarget, ['existing']);
      manager.insertLines(id, 0, 'prepended');
      expect(manager.getContent(id)).toBe('prepended\nexisting');
    });

    it('should handle multi-line content', () => {
      const id = manager.createFromLines(newPageTarget, ['before', 'after']);
      const result = manager.insertLines(id, 1, 'a\nb\nc');
      expect(result?.message).toContain('Inserted 3 line(s)');
      expect(manager.getContent(id)).toBe('before\na\nb\nc\nafter');
    });

    it('should return context markers', () => {
      const id = manager.createFromLines(newPageTarget, ['before', 'after']);
      const result = manager.insertLines(id, 1, 'new');
      expect(result?.context).toContain('before');
      expect(result?.context).toContain('new');
      expect(result?.context).toContain('after');
    });

    it('should error on out-of-bounds afterLine', () => {
      const id = manager.createFromLines(newPageTarget, ['one']);
      const result = manager.insertLines(id, 5, 'bad');
      expect(result?.message).toContain('out of range');
    });

    it('should return null for unknown scratchpad', () => {
      expect(manager.insertLines('sp-nope', 0, 'x')).toBeNull();
    });
  });

  // ── Append Lines ────────────────────────────────────────

  describe('appendLines', () => {
    it('should append to empty buffer', () => {
      const id = manager.createEmpty(newPageTarget);
      const result = manager.appendLines(id, 'hello');
      expect(result?.message).toContain('Appended 1 line(s)');
      expect(manager.getContent(id)).toBe('hello');
    });

    it('should append to existing content', () => {
      const id = manager.createFromLines(newPageTarget, ['existing']);
      manager.appendLines(id, 'new line');
      expect(manager.getContent(id)).toBe('existing\nnew line');
    });

    it('should handle multi-line append', () => {
      const id = manager.createEmpty(newPageTarget);
      manager.appendLines(id, 'a\nb\nc');
      expect(manager.getContent(id)).toBe('a\nb\nc');
    });
  });

  // ── Replace Lines ───────────────────────────────────────

  describe('replaceLines', () => {
    it('should replace a single line', () => {
      const id = manager.createFromLines(newPageTarget, ['a', 'b', 'c']);
      const result = manager.replaceLines(id, 2, 2, 'B');
      expect(result?.message).toContain('Replaced lines 2-2');
      expect(manager.getContent(id)).toBe('a\nB\nc');
    });

    it('should replace a range with different count', () => {
      const id = manager.createFromLines(newPageTarget, ['a', 'b', 'c', 'd']);
      manager.replaceLines(id, 2, 3, 'x\ny\nz');
      expect(manager.getContent(id)).toBe('a\nx\ny\nz\nd');
    });

    it('should replace a range with fewer lines', () => {
      const id = manager.createFromLines(newPageTarget, ['a', 'b', 'c', 'd']);
      manager.replaceLines(id, 2, 3, 'single');
      expect(manager.getContent(id)).toBe('a\nsingle\nd');
    });

    it('should error on invalid startLine', () => {
      const id = manager.createFromLines(newPageTarget, ['a']);
      const result = manager.replaceLines(id, 0, 1, 'x');
      expect(result?.message).toContain('out of range');
    });

    it('should error on endLine < startLine', () => {
      const id = manager.createFromLines(newPageTarget, ['a', 'b']);
      const result = manager.replaceLines(id, 2, 1, 'x');
      expect(result?.message).toContain('out of range');
    });
  });

  // ── Remove Lines ────────────────────────────────────────

  describe('removeLines', () => {
    it('should remove a single line', () => {
      const id = manager.createFromLines(newPageTarget, ['a', 'b', 'c']);
      const result = manager.removeLines(id, 2);
      expect(result?.message).toContain('Removed 1 line(s)');
      expect(manager.getContent(id)).toBe('a\nc');
    });

    it('should remove a range', () => {
      const id = manager.createFromLines(newPageTarget, ['a', 'b', 'c', 'd']);
      manager.removeLines(id, 2, 3);
      expect(manager.getContent(id)).toBe('a\nd');
    });

    it('should handle removing all lines', () => {
      const id = manager.createFromLines(newPageTarget, ['a', 'b']);
      manager.removeLines(id, 1, 2);
      expect(manager.getContent(id)).toBe('');
    });

    it('should show context at join point', () => {
      const id = manager.createFromLines(newPageTarget, ['a', 'b', 'c', 'd']);
      const result = manager.removeLines(id, 2, 3);
      expect(result?.context).toContain('a');
      expect(result?.context).toContain('d');
    });

    it('should error on out-of-bounds', () => {
      const id = manager.createFromLines(newPageTarget, ['a']);
      const result = manager.removeLines(id, 0);
      expect(result?.message).toContain('out of range');
    });
  });

  // ── Newline Normalization ───────────────────────────────

  describe('newline normalization', () => {
    it('should normalize CRLF', () => {
      const id = manager.createEmpty(newPageTarget);
      manager.appendLines(id, 'line1\r\nline2\r\nline3');
      expect(manager.getContent(id)).toBe('line1\nline2\nline3');
    });

    it('should normalize bare CR', () => {
      const id = manager.createEmpty(newPageTarget);
      manager.appendLines(id, 'line1\rline2');
      expect(manager.getContent(id)).toBe('line1\nline2');
    });

    it('should treat empty string as one empty line', () => {
      const id = manager.createEmpty(newPageTarget);
      manager.appendLines(id, '');
      const sp = manager.get(id);
      expect(sp?.lines).toEqual(['']);
    });
  });

  // ── Validation ──────────────────────────────────────────

  describe('validation', () => {
    it('should report valid for well-formed markdown', () => {
      const id = manager.createFromLines(newPageTarget, ['## Heading', '', 'A paragraph.']);
      const result = manager.appendLines(id, 'More text.');
      expect(result?.validation).toBe('Status: valid');
    });

    it('should report empty for empty buffer', () => {
      const id = manager.createEmpty(newPageTarget);
      const view = manager.view(id);
      expect(view).toContain('Status: empty');
    });

    it('should detect unclosed code fence', () => {
      const id = manager.createFromLines(newPageTarget, ['```js', 'const x = 1;']);
      const view = manager.view(id);
      expect(view).toContain('Status: invalid at line 1');
      expect(view).toContain('unclosed code fence');
    });

    it('should detect unclosed directive block', () => {
      const id = manager.createFromLines(newPageTarget, [
        ':::panel{type="info"}',
        'Some content',
      ]);
      const view = manager.view(id);
      expect(view).toContain('Status: invalid at line 1');
      expect(view).toContain('unclosed directive');
    });

    it('should report valid when directive is properly closed', () => {
      const id = manager.createFromLines(newPageTarget, [
        ':::panel{type="info"}',
        'Content here',
        ':::',
      ]);
      const view = manager.view(id);
      expect(view).toContain('Status: valid');
    });

    it('should report valid when code fence is properly closed', () => {
      const id = manager.createFromLines(newPageTarget, ['```js', 'code', '```']);
      const view = manager.view(id);
      expect(view).toContain('Status: valid');
    });

    it('should not flag inline directives as unclosed', () => {
      const id = manager.createFromLines(newPageTarget, [
        ':::status{color="green" title="Done"}:::',
      ]);
      const view = manager.view(id);
      expect(view).toContain('Status: valid');
    });

    it('should validate on every mutation', () => {
      const id = manager.createEmpty(newPageTarget);

      // Start with opening fence — invalid
      const r1 = manager.appendLines(id, '```js');
      expect(r1?.validation).toContain('invalid');

      // Close the fence — valid
      const r2 = manager.appendLines(id, 'code\n```');
      expect(r2?.validation).toBe('Status: valid');
    });
  });

  // ── Timeout ─────────────────────────────────────────────

  describe('timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should expire scratchpad after 30 minutes of inactivity', () => {
      const id = manager.createEmpty(newPageTarget);
      expect(manager.get(id)).not.toBeNull();

      vi.advanceTimersByTime(31 * 60 * 1000);
      expect(manager.get(id)).toBeNull();
    });

    it('should reset timeout on mutation', () => {
      const id = manager.createEmpty(newPageTarget);

      vi.advanceTimersByTime(20 * 60 * 1000);
      manager.appendLines(id, 'keep alive');

      vi.advanceTimersByTime(20 * 60 * 1000);
      expect(manager.get(id)).not.toBeNull();

      vi.advanceTimersByTime(31 * 60 * 1000);
      expect(manager.get(id)).toBeNull();
    });
  });

  // ── Discard ─────────────────────────────────────────────

  describe('discard', () => {
    it('should remove the scratchpad', () => {
      const id = manager.createEmpty(newPageTarget);
      expect(manager.discard(id)).toBe(true);
      expect(manager.get(id)).toBeNull();
    });

    it('should return false for unknown ID', () => {
      expect(manager.discard('sp-nope')).toBe(false);
    });
  });

  // ── List ────────────────────────────────────────────────

  describe('list', () => {
    it('should list all active scratchpads', () => {
      manager.createEmpty(newPageTarget);
      manager.createFromLines(existingPageTarget, ['content']);
      const list = manager.list();
      expect(list).toHaveLength(2);
    });

    it('should include target and line count', () => {
      manager.createFromLines(existingPageTarget, ['a', 'b', 'c']);
      const list = manager.list();
      expect(list[0].lineCount).toBe(3);
      expect(list[0].target.type).toBe('existing_page');
    });

    it('should return empty list when none exist', () => {
      expect(manager.list()).toHaveLength(0);
    });
  });

  // ── Multiple Scratchpads ────────────────────────────────

  describe('multiple scratchpads', () => {
    it('should maintain independent buffers', () => {
      const id1 = manager.createFromLines(newPageTarget, ['page 1']);
      const id2 = manager.createFromLines(existingPageTarget, ['page 2']);

      manager.appendLines(id1, 'more for page 1');

      expect(manager.getContent(id1)).toBe('page 1\nmore for page 1');
      expect(manager.getContent(id2)).toBe('page 2');
    });
  });
});
