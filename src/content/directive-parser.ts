/**
 * Markdown + ::: directive parser.
 * Converts LLM-facing content back into typed blocks.
 * See ADR-300 and ADR-302.
 */

import type {
  Block,
  ParagraphBlock,
  SectionBlock,
  TableBlock,
  CodeBlock,
  MacroBlock,
  ListBlock,
  RawAdfBlock,
  MediaFileBlock,
} from './blocks.js';

/**
 * Parse markdown with ::: directives into typed blocks.
 */
export function parseDirectives(input: string): Block[] {
  const lines = input.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  let blockId = 0;
  const nextId = () => `parsed-${++blockId}`;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({
        type: 'section',
        heading: headingMatch[2],
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        content: [],
        id: nextId(),
      } satisfies SectionBlock);
      i++;
      continue;
    }

    // Fenced code blocks
    const codeMatch = line.match(/^```(\w*)(.*)?$/);
    if (codeMatch) {
      const language = codeMatch[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        type: 'code',
        code: codeLines.join('\n'),
        language,
        id: nextId(),
      } satisfies CodeBlock);
      continue;
    }

    // Inline (bodyless) directive: :::name{params}:::
    const inlineDirectiveMatch = line.match(/^:::(\w[\w-]*)\{([^}]*)\}:::$/);
    if (inlineDirectiveMatch) {
      const macroId = inlineDirectiveMatch[1];
      const params = parseDirectiveParams(inlineDirectiveMatch[2]);

      // Special case: raw_adf sentinel → RawAdfBlock placeholder (ADR-304)
      if (macroId === 'raw_adf' && params.hash) {
        blocks.push({
          type: 'raw_adf',
          adf: {},
          hash: params.hash,
          id: nextId(),
        } satisfies RawAdfBlock);
        i++;
        continue;
      }

      // Special case: media file reference → MediaFileBlock placeholder (ADR-502)
      if (macroId === 'media' && params.file) {
        blocks.push({
          type: 'media_file',
          file: params.file,
          alt: params.alt,
          id: nextId(),
        } satisfies MediaFileBlock);
        i++;
        continue;
      }

      blocks.push({
        type: 'macro',
        macroId,
        params,
        id: nextId(),
      } satisfies MacroBlock);
      i++;
      continue;
    }

    // Block directive opening: :::name{params} or :::panel{type="info" title="..."}
    const blockDirectiveMatch = line.match(/^:::(\w[\w-]*)\{?([^}]*)?\}?\s*$/);
    if (blockDirectiveMatch && !line.endsWith(':::')) {
      const macroId = blockDirectiveMatch[1];
      const params = parseDirectiveParams(blockDirectiveMatch[2] ?? '');
      const bodyLines: string[] = [];
      i++;
      let depth = 1;
      while (i < lines.length && depth > 0) {
        if (lines[i].match(/^:::\w/) && !lines[i].endsWith(':::')) {
          depth++;
        }
        if (lines[i].trim() === ':::') {
          depth--;
          if (depth === 0) break;
        }
        bodyLines.push(lines[i]);
        i++;
      }
      i++; // skip closing :::

      const body = bodyLines.length > 0
        ? parseDirectives(bodyLines.join('\n'))
        : undefined;

      blocks.push({
        type: 'macro',
        macroId,
        params,
        body: body && body.length > 0 ? body : undefined,
        id: nextId(),
      } satisfies MacroBlock);
      continue;
    }

    // Table
    if (line.startsWith('|') && line.endsWith('|')) {
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && lines[i].startsWith('|') && lines[i].endsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const table = parseMarkdownTable(tableLines, nextId());
      if (table) {
        blocks.push(table);
        continue;
      }
    }

    // Lists
    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s/);
    if (listMatch) {
      const listLines: string[] = [line];
      i++;
      while (i < lines.length && (lines[i].match(/^\s*([-*]|\d+\.)\s/) || lines[i].match(/^\s{2,}/))) {
        listLines.push(lines[i]);
        i++;
      }
      const ordered = /^\s*\d+\./.test(listLines[0]);
      blocks.push({
        type: 'list',
        ordered,
        items: parseListItems(listLines),
        id: nextId(),
      } satisfies ListBlock);
      continue;
    }

    // Default: paragraph (collect contiguous non-empty, non-special lines)
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' &&
           !lines[i].startsWith('#') && !lines[i].startsWith('```') &&
           !lines[i].startsWith(':::') && !lines[i].startsWith('|') &&
           !lines[i].match(/^\s*([-*]|\d+\.)\s/)) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({
      type: 'paragraph',
      text: paraLines.join('\n'),
      id: nextId(),
    } satisfies ParagraphBlock);
  }

  // Group headings into sections with their following content
  return nestSections(blocks);
}

// ── Helpers ────────────────────────────────────────────────────

function parseDirectiveParams(raw: string): Record<string, string> {
  const params: Record<string, string> = {};
  // Match key="value" or key=value patterns
  const pattern = /(\w+)="([^"]*)"|\b(\w+)=(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    const key = match[1] ?? match[3];
    const value = match[2] ?? match[4];
    params[key] = value;
  }
  return params;
}

function parseMarkdownTable(lines: string[], id: string): TableBlock | null {
  if (lines.length < 2) return null;

  const parseRow = (line: string): string[] =>
    line.split('|').slice(1, -1).map(cell => cell.trim());

  const headers = parseRow(lines[0]);

  // Skip separator row (|---|---|)
  const startIdx = lines[1].match(/^\|[\s-:]+\|/) ? 2 : 1;

  const rows: string[][] = [];
  for (let i = startIdx; i < lines.length; i++) {
    rows.push(parseRow(lines[i]));
  }

  return { type: 'table', headers, rows, id };
}

function parseListItems(lines: string[]): Array<{ text: string; children?: { text: string }[] }> {
  const items: Array<{ text: string; children?: { text: string }[] }> = [];
  let i = 0;

  while (i < lines.length) {
    const match = lines[i].match(/^\s*([-*]|\d+\.)\s(.+)/);
    if (match) {
      const indent = lines[i].match(/^(\s*)/)?.[1].length ?? 0;
      const text = match[2];
      const children: { text: string }[] = [];

      i++;
      while (i < lines.length) {
        const childMatch = lines[i].match(/^(\s*)([-*]|\d+\.)\s(.+)/);
        if (childMatch && (childMatch[1].length > indent)) {
          children.push({ text: childMatch[3] });
          i++;
        } else {
          break;
        }
      }

      items.push({
        text,
        children: children.length > 0 ? children : undefined,
      });
    } else {
      i++;
    }
  }

  return items;
}

/**
 * Nest sections: headings become SectionBlocks that contain subsequent blocks
 * until the next heading of equal or higher level.
 */
function nestSections(blocks: Block[]): Block[] {
  const result: Block[] = [];
  let currentSection: SectionBlock | null = null;

  for (const block of blocks) {
    if (block.type === 'section') {
      if (currentSection) {
        result.push(currentSection);
      }
      currentSection = block;
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
