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

export interface TableBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
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
}

export interface RawAdfBlock {
  type: 'raw_adf';
  adf: object;
  hint?: string;
  id?: string;
}

// ── Session Block (extends Block with change tracking) ─────────
// See ADR-301: Session-Based Editing with Delta Sync.

export type SessionBlockState = 'unchanged' | 'modified' | 'inserted' | 'deleted';

export interface SessionBlock {
  block: Block;
  id: string;
  hash: string;
  state: SessionBlockState;
}
