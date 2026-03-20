/**
 * Block Model → ADF serializer.
 * Converts typed blocks back into a valid ADF document.
 * See ADR-300: ADF Content Model with Typed Blocks.
 */

import type { AdfNode } from './adf-parser.js';
import type {
  Block,
  SectionBlock,
  ParagraphBlock,
  TableCell,
  TableBlock,
  CodeBlock,
  MacroBlock,
  MediaBlock,
  ListBlock,
  RawAdfBlock,
  ListItem,
} from './blocks.js';

/**
 * Serialize a Block[] into a complete ADF document.
 */
export function serializeBlocks(blocks: Block[]): AdfNode {
  return {
    type: 'doc',
    version: 1,
    content: blocks.flatMap(serializeBlock),
  } as AdfNode;
}

function serializeBlock(block: Block): AdfNode[] {
  switch (block.type) {
    case 'section':
      return serializeSection(block);
    case 'paragraph':
      return [serializeParagraph(block)];
    case 'table':
      return [serializeTable(block)];
    case 'code':
      return [serializeCodeBlock(block)];
    case 'macro':
      return [serializeMacro(block)];
    case 'media':
      return [serializeMedia(block)];
    case 'list':
      return [serializeList(block)];
    case 'raw_adf':
      return [serializeRawAdf(block)];
    case 'media_file':
      // media_file blocks should be resolved to MediaBlocks before serialization
      return [];
  }
}

// ── Section ────────────────────────────────────────────────────

function serializeSection(block: SectionBlock): AdfNode[] {
  const heading: AdfNode = {
    type: 'heading',
    attrs: { level: block.level },
    content: parseInlineText(block.heading),
  };

  const children = block.content.flatMap(serializeBlock);
  return [heading, ...children];
}

// ── Paragraph ──────────────────────────────────────────────────

function serializeParagraph(block: ParagraphBlock): AdfNode {
  if (block.text === '') {
    return { type: 'paragraph' };
  }

  return {
    type: 'paragraph',
    content: parseInlineText(block.text),
  };
}

// ── Table ──────────────────────────────────────────────────────

function serializeTable(block: TableBlock): AdfNode {
  const rows: AdfNode[] = [];

  // Header row
  if (block.headers.length > 0) {
    rows.push({
      type: 'tableRow',
      content: block.headers.map(cell => serializeTableCell(cell, 'tableHeader')),
    });
  }

  // Data rows
  for (const row of block.rows) {
    rows.push({
      type: 'tableRow',
      content: row.map(cell => serializeTableCell(cell, 'tableCell')),
    });
  }

  return { type: 'table', content: rows };
}

function serializeTableCell(cell: string | TableCell, cellType: 'tableHeader' | 'tableCell'): AdfNode {
  const text = typeof cell === 'string' ? cell : cell.text;
  const node: AdfNode = {
    type: cellType,
    content: [{ type: 'paragraph', content: parseInlineText(text) }],
  };
  if (typeof cell === 'object') {
    const attrs: Record<string, unknown> = {};
    if (cell.colSpan && cell.colSpan > 1) attrs.colspan = cell.colSpan;
    if (cell.rowSpan && cell.rowSpan > 1) attrs.rowspan = cell.rowSpan;
    if (Object.keys(attrs).length > 0) node.attrs = attrs;
  }
  return node;
}

// ── Code Block ─────────────────────────────────────────────────

function serializeCodeBlock(block: CodeBlock): AdfNode {
  const node: AdfNode = {
    type: 'codeBlock',
    content: [{ type: 'text', text: block.code }],
  };

  if (block.language) {
    node.attrs = { language: block.language };
  }

  return node;
}

// ── Macro ──────────────────────────────────────────────────────

/** Panel types that map to native ADF panel nodes */
const PANEL_TYPES = new Set(['info', 'note', 'warning', 'error', 'success']);

function serializeMacro(block: MacroBlock): AdfNode {
  // Status → native inline node wrapped in paragraph
  if (block.macroId === 'status') {
    return {
      type: 'paragraph',
      content: [{
        type: 'status',
        attrs: {
          text: block.params.title ?? '',
          color: block.params.color ?? 'grey',
          style: 'bold',
        },
      }],
    };
  }

  // Panel types → native ADF panel node
  if (PANEL_TYPES.has(block.macroId)) {
    return {
      type: 'panel',
      attrs: { panelType: block.macroId },
      content: block.body ? block.body.flatMap(serializeBlock) : [],
    };
  }

  // Expand → native ADF expand node
  if (block.macroId === 'expand') {
    return {
      type: 'expand',
      attrs: { title: block.params.title ?? '' },
      content: block.body ? block.body.flatMap(serializeBlock) : [],
    };
  }

  // Everything else → extension/bodiedExtension (third-party macros)
  const macroParams: Record<string, { value: string }> = {};
  for (const [key, val] of Object.entries(block.params)) {
    macroParams[key] = { value: val };
  }

  const attrs: Record<string, unknown> = {
    extensionType: 'com.atlassian.confluence.macro.core',
    extensionKey: block.macroId,
    parameters: { macroParams },
  };

  if (block.body && block.body.length > 0) {
    return {
      type: 'bodiedExtension',
      attrs,
      content: block.body.flatMap(serializeBlock),
    };
  }

  return { type: 'extension', attrs };
}

// ── Media ──────────────────────────────────────────────────────

function serializeMedia(block: MediaBlock): AdfNode {
  return {
    type: 'mediaSingle',
    attrs: { layout: 'center' },
    content: [{
      type: 'media',
      attrs: {
        id: block.attachmentId,
        type: 'file',
        collection: '',
        ...(block.alt ? { alt: block.alt } : {}),
        ...(block.width ? { width: block.width } : {}),
      },
    }],
  };
}

// ── List ───────────────────────────────────────────────────────

function serializeList(block: ListBlock): AdfNode {
  return {
    type: block.ordered ? 'orderedList' : 'bulletList',
    content: block.items.map(serializeListItem),
  };
}

function serializeListItem(item: ListItem): AdfNode {
  const content: AdfNode[] = [
    { type: 'paragraph', content: parseInlineText(item.text) },
  ];

  if (item.children && item.children.length > 0) {
    content.push({
      type: item.childrenOrdered ? 'orderedList' : 'bulletList',
      content: item.children.map(child => serializeListItem({ text: child.text })),
    });
  }

  return { type: 'listItem', content };
}

// ── Raw ADF ────────────────────────────────────────────────────

function serializeRawAdf(block: RawAdfBlock): AdfNode {
  return block.adf as AdfNode;
}

// ── Inline Text Parsing ────────────────────────────────────────

/**
 * Parse a markdown-like text string into ADF inline nodes.
 * Handles: **bold**, *italic*, `code`, ~~strike~~, [text](url)
 */
function parseInlineText(text: string): AdfNode[] {
  if (!text) return [];

  const nodes: AdfNode[] = [];
  // Regex for inline marks and inline directives — ordered by specificity
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~|\[([^\]]+)\]\(([^)]+)\)|:::status\{([^}]*)\}:::)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Add plain text before the match
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      // **bold**
      nodes.push({ type: 'text', text: match[2], marks: [{ type: 'strong' }] });
    } else if (match[3]) {
      // *italic*
      nodes.push({ type: 'text', text: match[3], marks: [{ type: 'em' }] });
    } else if (match[4]) {
      // `code`
      nodes.push({ type: 'text', text: match[4], marks: [{ type: 'code' }] });
    } else if (match[5]) {
      // ~~strike~~
      nodes.push({ type: 'text', text: match[5], marks: [{ type: 'strike' }] });
    } else if (match[6] && match[7]) {
      // [text](url) — only allow safe protocols
      const href = match[7];
      const isSafe = /^(https?:\/\/|\/|#|mailto:)/.test(href);
      nodes.push({
        type: 'text',
        text: match[6],
        marks: isSafe ? [{ type: 'link', attrs: { href } }] : [],
      });
    } else if (match[8] !== undefined) {
      // :::status{color="..." title="..."}::: → native status node
      const paramsStr = match[8];
      const color = paramsStr.match(/color="([^"]*)"/)?.[1] ?? 'grey';
      const title = paramsStr.match(/title="([^"]*)"/)?.[1] ?? '';
      nodes.push({
        type: 'status',
        attrs: { text: title, color, style: 'bold' },
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining plain text
  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) });
  }

  // If no matches found, return single text node
  if (nodes.length === 0) {
    nodes.push({ type: 'text', text });
  }

  return nodes;
}
