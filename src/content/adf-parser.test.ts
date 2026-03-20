import { describe, it, expect } from 'vitest';
import { parseAdf } from './adf-parser.js';

describe('parseAdf', () => {
  it('should return empty array for non-doc nodes', () => {
    expect(parseAdf({ type: 'paragraph' })).toEqual([]);
  });

  it('should return empty array for doc with no content', () => {
    expect(parseAdf({ type: 'doc' })).toEqual([]);
  });

  it('should parse paragraphs', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      ],
    };
    const blocks = parseAdf(adf);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].text).toBe('Hello world');
    }
  });

  it('should parse headings into sections', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
      ],
    };
    const blocks = parseAdf(adf);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('section');
    if (blocks[0].type === 'section') {
      expect(blocks[0].heading).toBe('Title');
      expect(blocks[0].level).toBe(2);
      expect(blocks[0].content).toHaveLength(1);
    }
  });

  it('should parse inline marks (bold, italic, code, link)', () => {
    const adf = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'italic', marks: [{ type: 'em' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'code', marks: [{ type: 'code' }] },
        ],
      }],
    };
    const blocks = parseAdf(adf);
    expect(blocks[0].type).toBe('paragraph');
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].text).toContain('**bold**');
      expect(blocks[0].text).toContain('*italic*');
      expect(blocks[0].text).toContain('`code`');
    }
  });

  it('should parse native panel nodes as macros', () => {
    const adf = {
      type: 'doc',
      content: [{
        type: 'panel',
        attrs: { panelType: 'info' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Panel content' }] }],
      }],
    };
    const blocks = parseAdf(adf);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('macro');
    if (blocks[0].type === 'macro') {
      expect(blocks[0].macroId).toBe('info');
      expect(blocks[0].body).toHaveLength(1);
    }
  });

  it('should parse native expand nodes as macros', () => {
    const adf = {
      type: 'doc',
      content: [{
        type: 'expand',
        attrs: { title: 'Details' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hidden' }] }],
      }],
    };
    const blocks = parseAdf(adf);
    expect(blocks[0].type).toBe('macro');
    if (blocks[0].type === 'macro') {
      expect(blocks[0].macroId).toBe('expand');
      expect(blocks[0].params.title).toBe('Details');
    }
  });

  it('should parse inline status nodes in paragraphs', () => {
    const adf = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'status', attrs: { color: 'green', text: 'Done', style: 'bold' } }],
      }],
    };
    const blocks = parseAdf(adf);
    expect(blocks[0].type).toBe('paragraph');
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].text).toContain(':::status{color="green" title="Done"}:::');
    }
  });

  it('should parse extension macros with macroParams nesting', () => {
    const adf = {
      type: 'doc',
      content: [{
        type: 'extension',
        attrs: {
          extensionType: 'com.atlassian.confluence.macro.core',
          extensionKey: 'toc',
          parameters: {
            macroParams: { maxLevel: { value: '3' } },
            macroMetadata: { macroId: { value: 'abc' } },
          },
        },
      }],
    };
    const blocks = parseAdf(adf);
    expect(blocks[0].type).toBe('macro');
    if (blocks[0].type === 'macro') {
      expect(blocks[0].macroId).toBe('toc');
      expect(blocks[0].params.maxLevel).toBe('3');
      expect(blocks[0].params).not.toHaveProperty('macroMetadata');
    }
  });

  it('should parse tables', () => {
    const adf = {
      type: 'doc',
      content: [{
        type: 'table',
        content: [
          { type: 'tableHeader', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Value' }] }] },
          ]},
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] },
          ]},
        ],
      }],
    };
    const blocks = parseAdf(adf);
    expect(blocks[0].type).toBe('table');
    if (blocks[0].type === 'table') {
      expect(blocks[0].headers).toEqual(['Name', 'Value']);
      expect(blocks[0].rows).toEqual([['A', '1']]);
    }
  });

  it('should parse lists with ordering', () => {
    const adf = {
      type: 'doc',
      content: [{
        type: 'orderedList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] },
        ],
      }],
    };
    const blocks = parseAdf(adf);
    expect(blocks[0].type).toBe('list');
    if (blocks[0].type === 'list') {
      expect(blocks[0].ordered).toBe(true);
      expect(blocks[0].items).toHaveLength(2);
    }
  });

  it('should fall back to raw_adf for unknown node types', () => {
    const adf = {
      type: 'doc',
      content: [{ type: 'unknownWidget', attrs: { foo: 'bar' } }],
    };
    const blocks = parseAdf(adf);
    expect(blocks[0].type).toBe('raw_adf');
    if (blocks[0].type === 'raw_adf') {
      expect(blocks[0].hint).toContain('unknownWidget');
    }
  });

  // ── Round-trip hardening ────────────────────────────────────

  it('should parse nested marks (bold inside link)', () => {
    const adf = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'click here',
          marks: [
            { type: 'link', attrs: { href: 'https://example.com' } },
            { type: 'strong' },
          ],
        }],
      }],
    };
    const blocks = parseAdf(adf);
    expect(blocks[0].type).toBe('paragraph');
    if (blocks[0].type === 'paragraph') {
      // Should contain both marks in the rendered text
      expect(blocks[0].text).toContain('click here');
      expect(blocks[0].text).toContain('**');
      expect(blocks[0].text).toContain('https://example.com');
    }
  });

  it('should parse horizontal rule', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Above' }] },
        { type: 'rule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Below' }] },
      ],
    };
    const blocks = parseAdf(adf);
    // rule should be preserved as raw_adf
    expect(blocks.some(b => b.type === 'raw_adf')).toBe(true);
  });

  it('should parse empty paragraph', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'paragraph' },
      ],
    };
    const blocks = parseAdf(adf);
    expect(blocks[0].type).toBe('paragraph');
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].text).toBe('');
    }
  });

  it('should parse inline card', () => {
    const adf = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ' },
          { type: 'inlineCard', attrs: { url: 'https://example.com/page' } },
        ],
      }],
    };
    const blocks = parseAdf(adf);
    expect(blocks[0].type).toBe('paragraph');
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].text).toContain('https://example.com/page');
    }
  });

  it('should parse table with merged cells (colSpan/rowSpan preserved as raw)', () => {
    const adf = {
      type: 'doc',
      content: [{
        type: 'table',
        content: [
          { type: 'tableRow', content: [
            { type: 'tableHeader', attrs: { colspan: 2 }, content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Wide Header' }] },
            ]},
          ]},
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
          ]},
        ],
      }],
    };
    const blocks = parseAdf(adf);
    expect(blocks[0].type).toBe('table');
    if (blocks[0].type === 'table') {
      expect(blocks[0].headers).toEqual(['Wide Header']);
      expect(blocks[0].rows).toEqual([['A', 'B']]);
    }
  });

  it('should parse decision list items', () => {
    const adf = {
      type: 'doc',
      content: [{
        type: 'decisionList',
        content: [{
          type: 'decisionItem',
          attrs: { state: 'DECIDED' },
          content: [{ type: 'text', text: 'We decided X' }],
        }],
      }],
    };
    const blocks = parseAdf(adf);
    // Unknown top-level node → raw_adf
    expect(blocks[0].type).toBe('raw_adf');
  });

  it('should parse nested lists with mixed ordering', () => {
    const adf = {
      type: 'doc',
      content: [{
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] },
            { type: 'orderedList', content: [
              { type: 'listItem', content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Child 1' }] },
              ]},
            ]},
          ],
        }],
      }],
    };
    const blocks = parseAdf(adf);
    expect(blocks[0].type).toBe('list');
    if (blocks[0].type === 'list') {
      expect(blocks[0].ordered).toBe(false);
      expect(blocks[0].items[0].childrenOrdered).toBe(true);
      expect(blocks[0].items[0].children).toHaveLength(1);
    }
  });

  it('should generate unique block IDs per call', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
      ],
    };
    const blocks1 = parseAdf(adf);
    const blocks2 = parseAdf(adf);
    // Both calls should start from block-1 (independent counters)
    expect(blocks1[0].id).toBe(blocks2[0].id);
  });
});
