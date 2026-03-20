/**
 * Scratchpad buffer — line-addressed content authoring.
 * See ADR-304: Scratchpad Buffer — Line-Addressed Content Authoring.
 */

import { randomUUID } from 'node:crypto';

import { parseDirectives } from '../content/directive-parser.js';

// ── Types ──────────────────────────────────────────────────

export type ScratchpadTarget =
  | { type: 'new_page'; spaceId: string; title: string; parentId?: string }
  | { type: 'existing_page'; pageId: string; version: number; title: string };

export interface Scratchpad {
  id: string;
  lines: string[];
  target: ScratchpadTarget;
  rawAdfSideTable: Map<string, object>;
  createdAt: Date;
  lastModified: Date;
}

export interface MutationResult {
  message: string;
  context: string;
  validation: string;
}

export interface ScratchpadSummary {
  id: string;
  target: ScratchpadTarget;
  lineCount: number;
  validation: string;
  lastModified: Date;
}

// ── Scratchpad Manager ─────────────────────────────────────

const SCRATCHPAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class ScratchpadManager {
  private scratchpads: Map<string, Scratchpad> = new Map();

  /**
   * Create an empty scratchpad for new content.
   */
  createEmpty(target: ScratchpadTarget): string {
    const id = `sp-${randomUUID().slice(0, 12)}`;
    this.scratchpads.set(id, {
      id,
      lines: [],
      target,
      rawAdfSideTable: new Map(),
      createdAt: new Date(),
      lastModified: new Date(),
    });
    return id;
  }

  /**
   * Create a scratchpad pre-loaded with content (e.g., from pull_for_editing).
   */
  createFromLines(
    target: ScratchpadTarget,
    lines: string[],
    sideTable?: Map<string, object>,
  ): string {
    const id = `sp-${randomUUID().slice(0, 12)}`;
    this.scratchpads.set(id, {
      id,
      lines: [...lines],
      target,
      rawAdfSideTable: sideTable ? new Map(sideTable) : new Map(),
      createdAt: new Date(),
      lastModified: new Date(),
    });
    return id;
  }

  /**
   * Get a scratchpad by ID. Returns null if expired or not found.
   */
  get(id: string): Scratchpad | null {
    const sp = this.scratchpads.get(id);
    if (!sp) return null;

    const elapsed = Date.now() - sp.lastModified.getTime();
    if (elapsed > SCRATCHPAD_TIMEOUT_MS) {
      this.scratchpads.delete(id);
      return null;
    }

    return sp;
  }

  /**
   * View buffer content with line numbers and validation status.
   */
  view(id: string, startLine?: number, endLine?: number): string | null {
    const sp = this.get(id);
    if (!sp) return null;

    const start = startLine ? Math.max(1, startLine) : 1;
    const end = endLine ? Math.min(endLine, sp.lines.length) : sp.lines.length;

    const numbered = formatNumberedLines(sp.lines, start, end);
    const validation = validate(sp.lines);

    const header = `Scratchpad: ${sp.id} | ${formatTarget(sp.target)} | ${sp.lines.length} lines`;
    return `${header}\n${numbered}\n${validation}`;
  }

  /**
   * Insert lines after a given line number. afterLine=0 prepends.
   */
  insertLines(id: string, afterLine: number, content: string): MutationResult | null {
    const sp = this.get(id);
    if (!sp) return null;

    if (afterLine < 0 || afterLine > sp.lines.length) {
      return {
        message: `Error: afterLine ${afterLine} out of range (0-${sp.lines.length}).`,
        context: '',
        validation: validate(sp.lines),
      };
    }

    const newLines = normalizeAndSplit(content);
    sp.lines.splice(afterLine, 0, ...newLines);
    sp.lastModified = new Date();

    const affectedStart = afterLine + 1;
    const affectedEnd = afterLine + newLines.length;

    return {
      message: `Inserted ${newLines.length} line(s) after line ${afterLine}. Buffer: ${sp.lines.length} lines.`,
      context: formatContext(sp.lines, affectedStart, affectedEnd),
      validation: validate(sp.lines),
    };
  }

  /**
   * Append lines at the end of the buffer.
   */
  appendLines(id: string, content: string): MutationResult | null {
    const sp = this.get(id);
    if (!sp) return null;

    const newLines = normalizeAndSplit(content);
    const affectedStart = sp.lines.length + 1;
    sp.lines.push(...newLines);
    sp.lastModified = new Date();

    const affectedEnd = sp.lines.length;

    return {
      message: `Appended ${newLines.length} line(s). Buffer: ${sp.lines.length} lines.`,
      context: formatContext(sp.lines, affectedStart, affectedEnd),
      validation: validate(sp.lines),
    };
  }

  /**
   * Replace a range of lines with new content.
   */
  replaceLines(id: string, startLine: number, endLine: number, content: string): MutationResult | null {
    const sp = this.get(id);
    if (!sp) return null;

    if (startLine < 1 || startLine > sp.lines.length) {
      return {
        message: `Error: startLine ${startLine} out of range (1-${sp.lines.length}).`,
        context: '',
        validation: validate(sp.lines),
      };
    }
    if (endLine < startLine || endLine > sp.lines.length) {
      return {
        message: `Error: endLine ${endLine} out of range (${startLine}-${sp.lines.length}).`,
        context: '',
        validation: validate(sp.lines),
      };
    }

    const newLines = normalizeAndSplit(content);
    sp.lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
    sp.lastModified = new Date();

    const affectedEnd = startLine + newLines.length - 1;

    return {
      message: `Replaced lines ${startLine}-${endLine}. Buffer: ${sp.lines.length} lines.`,
      context: formatContext(sp.lines, startLine, affectedEnd),
      validation: validate(sp.lines),
    };
  }

  /**
   * Remove line(s) from the buffer.
   */
  removeLines(id: string, startLine: number, endLine?: number): MutationResult | null {
    const sp = this.get(id);
    if (!sp) return null;

    const end = endLine ?? startLine;

    if (startLine < 1 || startLine > sp.lines.length) {
      return {
        message: `Error: startLine ${startLine} out of range (1-${sp.lines.length}).`,
        context: '',
        validation: validate(sp.lines),
      };
    }
    if (end < startLine || end > sp.lines.length) {
      return {
        message: `Error: endLine ${end} out of range (${startLine}-${sp.lines.length}).`,
        context: '',
        validation: validate(sp.lines),
      };
    }

    sp.lines.splice(startLine - 1, end - startLine + 1);
    sp.lastModified = new Date();

    // Show join point
    const joinLine = Math.min(startLine, sp.lines.length);

    return {
      message: `Removed ${end - startLine + 1} line(s). Buffer: ${sp.lines.length} lines.`,
      context: formatRemoveContext(sp.lines, startLine, joinLine),
      validation: validate(sp.lines),
    };
  }

  /**
   * Get full buffer content as a single string.
   */
  getContent(id: string): string | null {
    const sp = this.get(id);
    if (!sp) return null;
    return sp.lines.join('\n');
  }

  /**
   * Get the raw ADF side-table for RawAdfBlock resolution.
   */
  getRawAdfSideTable(id: string): Map<string, object> | null {
    const sp = this.get(id);
    if (!sp) return null;
    return sp.rawAdfSideTable;
  }

  /**
   * Discard and invalidate a scratchpad.
   */
  discard(id: string): boolean {
    return this.scratchpads.delete(id);
  }

  /**
   * List all active scratchpads.
   */
  list(): ScratchpadSummary[] {
    const result: ScratchpadSummary[] = [];
    for (const sp of this.scratchpads.values()) {
      // Check timeout
      const elapsed = Date.now() - sp.lastModified.getTime();
      if (elapsed > SCRATCHPAD_TIMEOUT_MS) {
        this.scratchpads.delete(sp.id);
        continue;
      }
      result.push({
        id: sp.id,
        target: sp.target,
        lineCount: sp.lines.length,
        validation: validate(sp.lines),
        lastModified: sp.lastModified,
      });
    }
    return result;
  }
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Normalize CRLF/CR to LF and split into lines.
 */
function normalizeAndSplit(content: string): string[] {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/**
 * Format lines with line numbers for display.
 */
function formatNumberedLines(lines: string[], start: number, end: number): string {
  if (lines.length === 0) return '  (empty buffer)';

  const width = String(end).length;
  const result: string[] = [];
  for (let i = start; i <= end; i++) {
    result.push(`${String(i).padStart(width)} | ${lines[i - 1]}`);
  }
  return result.join('\n');
}

/**
 * Format a context marker showing the edit site with surrounding lines.
 */
function formatContext(lines: string[], affectedStart: number, affectedEnd: number): string {
  if (lines.length === 0) return '';

  const width = String(Math.min(affectedEnd + 1, lines.length)).length;
  const parts: string[] = [];

  // One line before
  if (affectedStart > 1) {
    const ln = affectedStart - 1;
    parts.push(`${String(ln).padStart(width)} | ${lines[ln - 1]}`);
  }

  // First affected line
  parts.push(`${String(affectedStart).padStart(width)} | ${lines[affectedStart - 1]}`);

  // Elide middle if > 2 affected lines
  if (affectedEnd - affectedStart > 1) {
    parts.push(`${' '.repeat(width)} | ...`);
  }

  // Last affected line (if different from first)
  if (affectedEnd > affectedStart) {
    parts.push(`${String(affectedEnd).padStart(width)} | ${lines[affectedEnd - 1]}`);
  }

  // One line after
  if (affectedEnd < lines.length) {
    const ln = affectedEnd + 1;
    parts.push(`${String(ln).padStart(width)} | ${lines[ln - 1]}`);
  }

  return parts.join('\n');
}

/**
 * Format context for a remove operation showing the join point.
 */
function formatRemoveContext(lines: string[], removedAt: number, joinLine: number): string {
  if (lines.length === 0) return '  (buffer now empty)';

  const width = String(Math.min(joinLine + 1, lines.length)).length;
  const parts: string[] = [];

  // Line before the removed range
  if (removedAt > 1 && removedAt - 1 <= lines.length) {
    const ln = removedAt - 1;
    parts.push(`${String(ln).padStart(width)} | ${lines[ln - 1]}`);
  }

  // Line at the join point (what's now at the removed position)
  if (joinLine >= 1 && joinLine <= lines.length) {
    parts.push(`${String(joinLine).padStart(width)} | ${lines[joinLine - 1]}`);
  }

  return parts.join('\n');
}

/**
 * Validate buffer content by running structural checks and parseDirectives.
 */
function validate(lines: string[]): string {
  if (lines.length === 0) return 'Status: empty';

  // Structural checks first — these give line-specific error messages
  const structuralError = checkStructure(lines);
  if (structuralError) return structuralError;

  // Final check: parse and see if it produces blocks
  try {
    const text = lines.join('\n');
    const blocks = parseDirectives(text);
    if (blocks.length === 0 && text.trim().length > 0) {
      return 'Status: invalid at line 1 — content produced no parseable blocks';
    }
    return 'Status: valid';
  } catch {
    return 'Status: invalid at line 1 — parse error';
  }
}

/**
 * Check for structural issues that can be pinpointed to specific lines.
 */
function checkStructure(lines: string[]): string | null {
  let codeBlockOpen = -1;
  let directiveDepth = 0;
  let directiveOpenLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Track fenced code blocks
    if (trimmed.startsWith('```')) {
      if (codeBlockOpen === -1) {
        codeBlockOpen = i + 1; // 1-based
      } else {
        codeBlockOpen = -1; // closed
      }
      continue;
    }

    // Skip structural checks inside code blocks
    if (codeBlockOpen !== -1) continue;

    // Track directive blocks — opening :::name (not inline :::name{...}:::)
    if (trimmed.match(/^:::\w/) && !trimmed.endsWith(':::')) {
      if (directiveDepth === 0) directiveOpenLine = i + 1;
      directiveDepth++;
    } else if (trimmed === ':::') {
      directiveDepth--;
    }
  }

  if (codeBlockOpen !== -1) {
    return `Status: invalid at line ${codeBlockOpen} — unclosed code fence`;
  }

  if (directiveDepth > 0) {
    return `Status: invalid at line ${directiveOpenLine} — unclosed directive block`;
  }

  return null;
}

/**
 * Format target description for display.
 */
function formatTarget(target: ScratchpadTarget): string {
  if (target.type === 'new_page') {
    return `New page: "${target.title}"`;
  }
  return `Page ${target.pageId} v${target.version}: "${target.title}"`;
}
