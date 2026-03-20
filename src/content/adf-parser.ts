/**
 * ADF → Block Model parser.
 * Walks the ADF tree and maps nodes to typed blocks.
 * See ADR-300: ADF Content Model with Typed Blocks.
 */

import type {
  Block,
  SectionBlock,
  ParagraphBlock,
  TableBlock,
  TableCell,
  CodeBlock,
  MacroBlock,
  MediaBlock,
  ListBlock,
  RawAdfBlock,
} from './blocks.js';

// ── ADF Node Types (subset of @atlaskit/adf-schema) ───────────

export interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: AdfMark[];
}

interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

// ── Macro Category Lookup ─────────────────────────────────────

const MACRO_CATEGORIES: Record<string, string> = {
  'mermaid': 'diagram:mermaid',
  'mermaid-cloud': 'diagram:mermaid',
  'drawio': 'diagram:drawio',
  'draw.io': 'diagram:drawio',
  'gliffy': 'diagram:gliffy',
  'image': 'visual:image',
  'gallery': 'visual:image',
  'chart': 'visual:chart',
};

// ── ID Generator ──────────────────────────────────────────────

function createIdGenerator(): () => string {
  let counter = 0;
  return () => `block-${++counter}`;
}

// ── Parser ─────────────────────────────────────────────────────

/**
 * Parse an ADF document into typed blocks.
 * Each call gets its own ID counter — safe for concurrent use.
 */
export function parseAdf(adfDocument: AdfNode): Block[] {
  if (adfDocument.type !== 'doc' || !adfDocument.content) {
    return [];
  }

  const nextId = createIdGenerator();

  function parseNode(node: AdfNode): Block {
    switch (node.type) {
      case 'heading':
        return parseHeading(node);
      case 'paragraph':
        return parseParagraph(node);
      case 'table':
        return parseTable(node);
      case 'codeBlock':
        return parseCodeBlock(node);
      case 'panel':
        return parsePanel(node);
      case 'expand':
        return parseExpand(node);
      case 'extension':
      case 'bodiedExtension':
        return parseMacro(node);
      case 'mediaGroup':
      case 'mediaSingle':
        return parseMedia(node);
      case 'bulletList':
        return parseList(node, false);
      case 'orderedList':
        return parseList(node, true);
      default:
        return parseRawAdf(node);
    }
  }

  function parsePanel(node: AdfNode): MacroBlock {
    const panelType = (node.attrs?.panelType as string) ?? 'info';
    const body = node.content ? node.content.map(parseNode) : undefined;
    return {
      type: 'macro',
      macroId: panelType, // info, note, warning, error, success
      params: {},
      body: body && body.length > 0 ? body : undefined,
      id: nextId(),
    };
  }

  function parseExpand(node: AdfNode): MacroBlock {
    const title = (node.attrs?.title as string) ?? '';
    const body = node.content ? node.content.map(parseNode) : undefined;
    return {
      type: 'macro',
      macroId: 'expand',
      params: { title },
      body: body && body.length > 0 ? body : undefined,
      id: nextId(),
    };
  }

  function parseHeading(node: AdfNode): ParagraphBlock {
    const level = (node.attrs?.level as number) ?? 1;
    const text = extractText(node);
    return {
      type: 'paragraph',
      text: `${'#'.repeat(level)} ${text}`,
      id: nextId(),
    };
  }

  function parseParagraph(node: AdfNode): ParagraphBlock {
    return {
      type: 'paragraph',
      text: extractText(node),
      id: nextId(),
    };
  }

  function parseTable(node: AdfNode): TableBlock {
    const headers: (string | TableCell)[] = [];
    const rows: (string | TableCell)[][] = [];

    if (!node.content) return { type: 'table', headers: [], rows: [], id: nextId() };

    for (let i = 0; i < node.content.length; i++) {
      const row = node.content[i];
      if (!row.content) continue;

      const cells = row.content.map(cell => parseTableCell(cell));

      if (i === 0 && row.type === 'tableHeader') {
        headers.push(...cells);
      } else if (i === 0 && row.type === 'tableRow' && headers.length === 0) {
        headers.push(...cells);
      } else {
        rows.push(cells);
      }
    }

    return { type: 'table', headers, rows, id: nextId() };
  }

  function parseTableCell(cell: AdfNode): string | TableCell {
    const text = extractText(cell);
    const colSpan = cell.attrs?.colspan as number | undefined;
    const rowSpan = cell.attrs?.rowspan as number | undefined;
    if ((colSpan && colSpan > 1) || (rowSpan && rowSpan > 1)) {
      return { text, colSpan, rowSpan };
    }
    return text;
  }

  function parseCodeBlock(node: AdfNode): CodeBlock {
    return {
      type: 'code',
      code: extractText(node),
      language: node.attrs?.language as string | undefined,
      id: nextId(),
    };
  }

  function parseMacro(node: AdfNode): MacroBlock {
    const attrs = node.attrs ?? {};
    const extensionKey = (attrs.extensionKey as string) ?? 'unknown';

    // Parameters may be nested under macroParams (Confluence canonical format)
    const parameters = attrs.parameters as Record<string, unknown> | undefined;
    const macroParams = (parameters?.macroParams ?? parameters ?? {}) as Record<string, { value: string }>;

    const params: Record<string, string> = {};
    for (const [key, val] of Object.entries(macroParams)) {
      if (key === 'macroMetadata') continue; // skip metadata, not a user param
      params[key] = typeof val === 'object' && val !== null && 'value' in val ? val.value : String(val);
    }

    const body = node.content ? node.content.map(parseNode) : undefined;

    return {
      type: 'macro',
      macroId: extensionKey,
      params,
      body: body && body.length > 0 ? body : undefined,
      category: MACRO_CATEGORIES[extensionKey],
      id: nextId(),
    };
  }

  function parseMedia(node: AdfNode): MediaBlock {
    const mediaNode = node.content?.find(n => n.type === 'media');
    const attrs = mediaNode?.attrs ?? node.attrs ?? {};

    return {
      type: 'media',
      attachmentId: (attrs.id as string) ?? '',
      filename: (attrs.alt as string) ?? (attrs.title as string) ?? 'untitled',
      mediaType: (attrs.type as string) ?? 'file',
      alt: attrs.alt as string | undefined,
      width: attrs.width as number | undefined,
      id: nextId(),
    };
  }

  function parseList(node: AdfNode, ordered: boolean): ListBlock {
    const items = (node.content ?? []).map(parseListItem);
    return { type: 'list', ordered, items, id: nextId() };
  }

  function parseListItem(node: AdfNode): { text: string; children?: { text: string }[]; childrenOrdered?: boolean } {
    const textParts: string[] = [];
    const children: { text: string }[] = [];
    let childrenOrdered: boolean | undefined;

    for (const child of node.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        childrenOrdered = child.type === 'orderedList';
        for (const subItem of child.content ?? []) {
          children.push({ text: extractText(subItem) });
        }
      } else {
        textParts.push(extractText(child));
      }
    }

    return {
      text: textParts.join('\n'),
      children: children.length > 0 ? children : undefined,
      childrenOrdered,
    };
  }

  function parseRawAdf(node: AdfNode): RawAdfBlock {
    return {
      type: 'raw_adf',
      adf: node,
      hint: `Unsupported ADF node: ${node.type}`,
      id: nextId(),
    };
  }

  return groupIntoSections(adfDocument.content.map(parseNode));
}

// ── Text Extraction ────────────────────────────────────────────

function extractText(node: AdfNode): string {
  if (node.text) {
    return applyMarks(node.text, node.marks);
  }

  // Inline status node → render as directive
  if (node.type === 'status') {
    const color = (node.attrs?.color as string) ?? 'grey';
    const text = (node.attrs?.text as string) ?? '';
    return `:::status{color="${color}" title="${text}"}:::`;
  }

  // Inline card → render as link
  if (node.type === 'inlineCard' && node.attrs?.url) {
    return `[${node.attrs.url}](${node.attrs.url})`;
  }

  if (!node.content) return '';

  return node.content.map(extractText).join('');
}

function applyMarks(text: string, marks?: AdfMark[]): string {
  if (!marks) return text;

  let result = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'strong':
        result = `**${result}**`;
        break;
      case 'em':
        result = `*${result}*`;
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'strike':
        result = `~~${result}~~`;
        break;
      case 'link':
        result = `[${result}](${mark.attrs?.href ?? ''})`;
        break;
    }
  }
  return result;
}

// ── Section Grouping ───────────────────────────────────────────

function groupIntoSections(blocks: Block[]): Block[] {
  const result: Block[] = [];
  let currentSection: SectionBlock | null = null;

  for (const block of blocks) {
    if (block.type === 'paragraph' && block.text.match(/^#{1,6}\s/)) {
      if (currentSection) {
        result.push(currentSection);
      }
      const match = block.text.match(/^(#{1,6})\s+(.*)/);
      if (match) {
        currentSection = {
          type: 'section',
          heading: match[2],
          level: match[1].length as 1 | 2 | 3 | 4 | 5 | 6,
          content: [],
          id: block.id,
        };
      }
    } else if (currentSection) {
      currentSection.content.push(block);
    } else {
      result.push(block);
    }
  }

  if (currentSection) {
    result.push(currentSection);
  }

  return result;
}
