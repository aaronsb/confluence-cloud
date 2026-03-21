/**
 * Typed block model — intermediate representation between ADF and LLM-facing markdown.
 * See ADR-300: ADF Content Model with Typed Blocks.
 */

// ── Block Union Type ───────────────────────────────────────────

export type Block =
  | SectionBlock
  | ParagraphBlock
  | TableBlock
  | CodeBlock
  | MacroBlock
  | MediaBlock
  | MediaFileBlock
  | ListBlock
  | RawAdfBlock;

// ── Block Interfaces ───────────────────────────────────────────

export interface SectionBlock {
  type: 'section';
  heading: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  content: Block[];
  id?: string;
}

export interface ParagraphBlock {
  type: 'paragraph';
  text: string;
  id?: string;
}

export interface TableCell {
  text: string;
  colSpan?: number;
  rowSpan?: number;
}

export interface TableBlock {
  type: 'table';
  headers: (string | TableCell)[];
  rows: (string | TableCell)[][];
  id?: string;
}

export interface CodeBlock {
  type: 'code';
  code: string;
  language?: string;
  title?: string;
  id?: string;
}

export interface MacroBlock {
  type: 'macro';
  macroId: string;
  params: Record<string, string>;
  body?: Block[];
  category?: string;
  id?: string;
}

export interface MediaBlock {
  type: 'media';
  attachmentId: string;
  filename: string;
  mediaType: string;
  alt?: string;
  width?: number;
  id?: string;
}

export interface ListBlock {
  type: 'list';
  ordered: boolean;
  items: ListItem[];
  id?: string;
}

export interface ListItem {
  text: string;
  children?: ListItem[];
  childrenOrdered?: boolean;
}

export interface MediaFileBlock {
  type: 'media_file';
  file: string;
  alt?: string;
  id?: string;
}

export interface RawAdfBlock {
  type: 'raw_adf';
  adf: object;
  hint?: string;
  hash?: string;
  id?: string;
}

