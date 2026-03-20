/**
 * Block Model → LLM-facing markdown renderer.
 * Converts typed blocks to readable markdown with ::: directive syntax for macros.
 * See ADR-300 and ADR-302.
 */

import type { Block, ListItem } from './blocks.js';

export function renderBlocks(blocks: Block[]): string {
  return blocks.map(renderBlock).join('\n\n');
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case 'section':
      return renderSection(block);
    case 'paragraph':
      return block.text;
    case 'table':
      return renderTable(block);
    case 'code':
      return renderCode(block);
    case 'macro':
      return renderMacro(block);
    case 'media':
      return `[Image: ${block.alt ?? block.filename} | att:${block.attachmentId} — use manage_confluence_media view to see]`;
    case 'list':
      return renderList(block.items, block.ordered, 0);
    case 'raw_adf':
      return block.hint
        ? `<!-- ${block.hint} -->`
        : '<!-- Unsupported ADF content -->';
  }
}

function renderSection(block: Extract<Block, { type: 'section' }>): string {
  const heading = `${'#'.repeat(block.level)} ${block.heading}`;
  if (block.content.length === 0) return heading;
  return `${heading}\n\n${renderBlocks(block.content)}`;
}

function cellText(cell: string | { text: string; colSpan?: number; rowSpan?: number }): string {
  return typeof cell === 'string' ? cell : cell.text;
}

function renderTable(block: Extract<Block, { type: 'table' }>): string {
  if (block.headers.length === 0) return '';

  const headerRow = `| ${block.headers.map(cellText).join(' | ')} |`;
  const separator = `| ${block.headers.map(() => '---').join(' | ')} |`;
  const dataRows = block.rows.map(row => `| ${row.map(cellText).join(' | ')} |`);

  return [headerRow, separator, ...dataRows].join('\n');
}

function renderCode(block: Extract<Block, { type: 'code' }>): string {
  const lang = block.language ?? '';
  const titleComment = block.title ? ` title="${block.title}"` : '';
  return `\`\`\`${lang}${titleComment}\n${block.code}\n\`\`\``;
}

function renderMacro(block: Extract<Block, { type: 'macro' }>): string {
  const paramsStr = Object.entries(block.params)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');

  const attrs = paramsStr ? `{${paramsStr}}` : '';
  const categoryTag = block.category ? ` [${block.category}]` : '';

  // Panel-type macros (info, note, warning, error) use unified panel syntax
  if (['info', 'note', 'warning', 'error'].includes(block.macroId)) {
    const titleAttr = block.params.title ? ` title="${block.params.title}"` : '';
    const body = block.body ? `\n${renderBlocks(block.body)}\n` : '\n';
    return `:::panel{type="${block.macroId}"${titleAttr}}${body}:::`;
  }

  // Body macros
  if (block.body && block.body.length > 0) {
    const body = renderBlocks(block.body);
    return `:::${block.macroId}${attrs}${categoryTag}\n${body}\n:::`;
  }

  // Inline/bodyless macros
  return `:::${block.macroId}${attrs}${categoryTag}:::`;
}

function renderList(items: ListItem[], ordered: boolean, depth: number): string {
  const indent = '  '.repeat(depth);
  return items.map((item, i) => {
    const marker = ordered ? `${i + 1}.` : '-';
    let result = `${indent}${marker} ${item.text}`;
    if (item.children && item.children.length > 0) {
      const childOrdered = item.childrenOrdered ?? ordered;
      result += '\n' + renderList(item.children.map(c => ({ text: c.text })), childOrdered, depth + 1);
    }
    return result;
  }).join('\n');
}
