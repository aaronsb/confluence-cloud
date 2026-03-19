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

// ── Parser ─────────────────────────────────────────────────────

let blockIdCounter = 0;

function nextId(): string {
  return `block-${++blockIdCounter}`;
}

export function resetIdCounter(): void {
  blockIdCounter = 0;
}

/**
 * Parse an ADF document into typed blocks.
 */
export function parseAdf(adfDocument: AdfNode): Block[] {
  if (adfDocument.type !== 'doc' || !adfDocument.content) {
    return [];
  }

  return groupIntoSections(adfDocument.content.map(parseNode));
}

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

function parseHeading(node: AdfNode): ParagraphBlock {
  // Headings are converted to section boundaries during groupIntoSections
  // For now, represent as a paragraph with heading marker
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
  const headers: string[] = [];
  const rows: string[][] = [];

  if (!node.content) return { type: 'table', headers: [], rows: [], id: nextId() };

  for (let i = 0; i < node.content.length; i++) {
    const row = node.content[i];
    if (!row.content) continue;

    const cells = row.content.map(cell => extractText(cell));

    if (i === 0 && row.type === 'tableHeader') {
      headers.push(...cells);
    } else if (i === 0 && row.type === 'tableRow' && headers.length === 0) {
      // First row as headers if no explicit header row
      headers.push(...cells);
    } else {
      rows.push(cells);
    }
  }

  return { type: 'table', headers, rows, id: nextId() };
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
  const rawParams = (attrs.parameters as Record<string, { value: string }>) ?? {};

  // Flatten Confluence's {value: string} parameter wrapping
  const params: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawParams)) {
    params[key] = typeof val === 'object' && val !== null && 'value' in val ? val.value : String(val);
  }

  const body = node.content ? node.content.map(parseNode) : undefined;

  return {
    type: 'macro',
    macroId: extensionKey,
    params,
    body: body && body.length > 0 ? body : undefined,
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

function parseListItem(node: AdfNode): { text: string; children?: { text: string }[] } {
  const textParts: string[] = [];
  const children: { text: string }[] = [];

  for (const child of node.content ?? []) {
    if (child.type === 'bulletList' || child.type === 'orderedList') {
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

// ── Text Extraction ────────────────────────────────────────────

function extractText(node: AdfNode): string {
  if (node.text) {
    return applyMarks(node.text, node.marks);
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

/**
 * Group flat blocks into sections based on headings.
 * Paragraphs starting with # markers become section boundaries.
 */
function groupIntoSections(blocks: Block[]): Block[] {
  const result: Block[] = [];
  let currentSection: SectionBlock | null = null;

  for (const block of blocks) {
    if (block.type === 'paragraph' && block.text.match(/^#{1,6}\s/)) {
      // This is a heading — start a new section
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
