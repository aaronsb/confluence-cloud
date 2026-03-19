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
      content: block.headers.map(cell => ({
        type: 'tableHeader',
        content: [{ type: 'paragraph', content: parseInlineText(cell) }],
      })),
    });
  }

  // Data rows
  for (const row of block.rows) {
    rows.push({
      type: 'tableRow',
      content: row.map(cell => ({
        type: 'tableCell',
        content: [{ type: 'paragraph', content: parseInlineText(cell) }],
      })),
    });
  }

  return { type: 'table', content: rows };
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

function serializeMacro(block: MacroBlock): AdfNode {
  // Wrap params in Confluence's {value: string} format
  const macroParams: Record<string, { value: string }> = {};
  for (const [key, val] of Object.entries(block.params)) {
    macroParams[key] = { value: val };
  }

  const attrs: Record<string, unknown> = {
    extensionType: 'com.atlassian.confluence.macro.core',
    extensionKey: block.macroId,
    parameters: { macroParams },
  };

  // Bodied macros (panels, expand, excerpt) use bodiedExtension
  if (block.body && block.body.length > 0) {
    return {
      type: 'bodiedExtension',
      attrs,
      content: block.body.flatMap(serializeBlock),
    };
  }

  return {
    type: 'extension',
    attrs,
  };
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
        type: block.mediaType,
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
      type: 'bulletList',
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
  // Regex for inline marks — ordered by specificity
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~|\[([^\]]+)\]\(([^)]+)\))/g;

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
      // [text](url)
      nodes.push({
        type: 'text',
        text: match[6],
        marks: [{ type: 'link', attrs: { href: match[7] } }],
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
