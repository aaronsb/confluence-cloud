import { describe, it, expect } from 'vitest';
import { parseDirectives } from './directive-parser.js';

describe('parseDirectives', () => {
  it('should parse plain paragraphs', () => {
    const blocks = parseDirectives('Hello world');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
  });

  it('should parse headings into sections', () => {
    const blocks = parseDirectives('## My Section\n\nSome content');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('section');
    if (blocks[0].type === 'section') {
      expect(blocks[0].heading).toBe('My Section');
      expect(blocks[0].level).toBe(2);
      expect(blocks[0].content).toHaveLength(1);
    }
  });

  it('should parse fenced code blocks', () => {
    const blocks = parseDirectives('```typescript\nconst x = 1;\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('code');
    if (blocks[0].type === 'code') {
      expect(blocks[0].language).toBe('typescript');
      expect(blocks[0].code).toBe('const x = 1;');
    }
  });

  it('should parse inline (bodyless) directives', () => {
    const blocks = parseDirectives(':::status{color="green" title="Done"}:::');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('macro');
    if (blocks[0].type === 'macro') {
      expect(blocks[0].macroId).toBe('status');
      expect(blocks[0].params.color).toBe('green');
      expect(blocks[0].params.title).toBe('Done');
    }
  });

  it('should parse block directives with body', () => {
    const input = ':::panel{type="info" title="Note"}\nSome important info\n:::';
    const blocks = parseDirectives(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('macro');
    if (blocks[0].type === 'macro') {
      expect(blocks[0].macroId).toBe('panel');
      expect(blocks[0].params.type).toBe('info');
      expect(blocks[0].body).toHaveLength(1);
    }
  });

  it('should parse markdown tables', () => {
    const input = '| Name | Value |\n| --- | --- |\n| A | 1 |\n| B | 2 |';
    const blocks = parseDirectives(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('table');
    if (blocks[0].type === 'table') {
      expect(blocks[0].headers).toEqual(['Name', 'Value']);
      expect(blocks[0].rows).toEqual([['A', '1'], ['B', '2']]);
    }
  });

  it('should parse unordered lists', () => {
    const blocks = parseDirectives('- First\n- Second\n- Third');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('list');
    if (blocks[0].type === 'list') {
      expect(blocks[0].ordered).toBe(false);
      expect(blocks[0].items).toHaveLength(3);
    }
  });

  it('should parse ordered lists', () => {
    const blocks = parseDirectives('1. First\n2. Second');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('list');
    if (blocks[0].type === 'list') {
      expect(blocks[0].ordered).toBe(true);
      expect(blocks[0].items).toHaveLength(2);
    }
  });

  it('should handle mixed content', () => {
    const input = [
      'Intro paragraph',
      '',
      '## Section One',
      '',
      'Section content',
      '',
      ':::status{color="red" title="Blocked"}:::',
      '',
      '## Section Two',
      '',
      '```python',
      'print("hello")',
      '```',
    ].join('\n');

    const blocks = parseDirectives(input);
    // paragraph, section (with content + status), section (with code)
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[1].type).toBe('section');
    expect(blocks[2].type).toBe('section');
  });

  it('should handle empty input', () => {
    expect(parseDirectives('')).toEqual([]);
  });
});
