import { describe, it, expect } from 'vitest';
import { serializeBlocks } from './adf-serializer.js';
import type { Block } from './blocks.js';

describe('serializeBlocks', () => {
  it('should produce a valid ADF doc wrapper', () => {
    const adf = serializeBlocks([]);
    expect(adf.type).toBe('doc');
    expect((adf as Record<string, unknown>).version).toBe(1);
    expect(adf.content).toEqual([]);
  });

  it('should serialize paragraphs with text', () => {
    const blocks: Block[] = [
      { type: 'paragraph', text: 'Hello world', id: '1' },
    ];
    const adf = serializeBlocks(blocks);
    expect(adf.content).toHaveLength(1);
    expect(adf.content![0].type).toBe('paragraph');
    expect(adf.content![0].content![0].text).toBe('Hello world');
  });

  it('should serialize bold and italic inline marks', () => {
    const blocks: Block[] = [
      { type: 'paragraph', text: 'This is **bold** and *italic*', id: '1' },
    ];
    const adf = serializeBlocks(blocks);
    const content = adf.content![0].content!;
    const boldNode = content.find(n => n.marks?.some(m => m.type === 'strong'));
    const italicNode = content.find(n => n.marks?.some(m => m.type === 'em'));
    expect(boldNode?.text).toBe('bold');
    expect(italicNode?.text).toBe('italic');
  });

  it('should serialize sections as headings + children', () => {
    const blocks: Block[] = [{
      type: 'section',
      heading: 'Title',
      level: 2,
      content: [{ type: 'paragraph', text: 'Body', id: '2' }],
      id: '1',
    }];
    const adf = serializeBlocks(blocks);
    expect(adf.content).toHaveLength(2);
    expect(adf.content![0].type).toBe('heading');
    expect(adf.content![0].attrs?.level).toBe(2);
    expect(adf.content![1].type).toBe('paragraph');
  });

  it('should serialize status macro as native inline node', () => {
    const blocks: Block[] = [{
      type: 'macro',
      macroId: 'status',
      params: { color: 'green', title: 'Done' },
      id: '1',
    }];
    const adf = serializeBlocks(blocks);
    const para = adf.content![0];
    expect(para.type).toBe('paragraph');
    const status = para.content![0];
    expect(status.type).toBe('status');
    expect(status.attrs?.color).toBe('green');
    expect(status.attrs?.text).toBe('Done');
  });

  it('should serialize panel macros as native panel nodes', () => {
    for (const panelType of ['info', 'note', 'warning', 'error', 'success']) {
      const blocks: Block[] = [{
        type: 'macro',
        macroId: panelType,
        params: {},
        body: [{ type: 'paragraph', text: 'Content', id: '2' }],
        id: '1',
      }];
      const adf = serializeBlocks(blocks);
      expect(adf.content![0].type).toBe('panel');
      expect(adf.content![0].attrs?.panelType).toBe(panelType);
    }
  });

  it('should serialize expand macro as native expand node', () => {
    const blocks: Block[] = [{
      type: 'macro',
      macroId: 'expand',
      params: { title: 'Click me' },
      body: [{ type: 'paragraph', text: 'Hidden', id: '2' }],
      id: '1',
    }];
    const adf = serializeBlocks(blocks);
    expect(adf.content![0].type).toBe('expand');
    expect(adf.content![0].attrs?.title).toBe('Click me');
  });

  it('should serialize unknown macros as extension nodes', () => {
    const blocks: Block[] = [{
      type: 'macro',
      macroId: 'custom-chart',
      params: { dataSource: 'jql' },
      id: '1',
    }];
    const adf = serializeBlocks(blocks);
    expect(adf.content![0].type).toBe('extension');
    expect(adf.content![0].attrs?.extensionKey).toBe('custom-chart');
  });

  it('should serialize tables with headers and rows', () => {
    const blocks: Block[] = [{
      type: 'table',
      headers: ['Name', 'Value'],
      rows: [['A', '1'], ['B', '2']],
      id: '1',
    }];
    const adf = serializeBlocks(blocks);
    const table = adf.content![0];
    expect(table.type).toBe('table');
    expect(table.content).toHaveLength(3); // 1 header + 2 data rows
    expect(table.content![0].content![0].type).toBe('tableHeader');
    expect(table.content![1].content![0].type).toBe('tableCell');
  });

  it('should serialize ordered and unordered lists', () => {
    const blocks: Block[] = [
      { type: 'list', ordered: true, items: [{ text: 'First' }, { text: 'Second' }], id: '1' },
      { type: 'list', ordered: false, items: [{ text: 'Bullet' }], id: '2' },
    ];
    const adf = serializeBlocks(blocks);
    expect(adf.content![0].type).toBe('orderedList');
    expect(adf.content![1].type).toBe('bulletList');
  });

  it('should preserve nested list ordering', () => {
    const blocks: Block[] = [{
      type: 'list',
      ordered: true,
      items: [{
        text: 'Parent',
        children: [{ text: 'Child' }],
        childrenOrdered: false,
      }],
      id: '1',
    }];
    const adf = serializeBlocks(blocks);
    const listItem = adf.content![0].content![0];
    const nestedList = listItem.content![1];
    expect(nestedList.type).toBe('bulletList');
  });

  it('should pass through raw_adf blocks unchanged', () => {
    const rawNode = { type: 'customWidget', attrs: { x: 1 } };
    const blocks: Block[] = [{
      type: 'raw_adf',
      adf: rawNode,
      id: '1',
    }];
    const adf = serializeBlocks(blocks);
    expect(adf.content![0]).toEqual(rawNode);
  });

  it('should block javascript: URLs in links', () => {
    const blocks: Block[] = [
      { type: 'paragraph', text: '[click](javascript:alert(1))', id: '1' },
    ];
    const adf = serializeBlocks(blocks);
    const textNode = adf.content![0].content!.find(n => n.text === 'click');
    expect(textNode?.marks).toEqual([]);
  });

  it('should allow https and relative URLs in links', () => {
    const blocks: Block[] = [
      { type: 'paragraph', text: '[link](https://example.com) and [local](/page)', id: '1' },
    ];
    const adf = serializeBlocks(blocks);
    const nodes = adf.content![0].content!;
    const httpsNode = nodes.find(n => n.text === 'link');
    const localNode = nodes.find(n => n.text === 'local');
    expect(httpsNode?.marks?.[0].attrs?.href).toBe('https://example.com');
    expect(localNode?.marks?.[0].attrs?.href).toBe('/page');
  });
});
