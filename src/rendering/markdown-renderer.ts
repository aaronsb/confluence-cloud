/**
 * Rendering facades for Confluence entities → token-efficient markdown.
 * See ADR-500: Rendering Facades and Semantic Hinting.
 */

import type { Page, Space, SearchResult, Attachment } from '../types/index.js';

export function renderPage(page: Page, options?: { showBody?: boolean }): string {
  const lines: string[] = [];

  // Header line: icon + title + space + status + version + date
  const parts = [
    `📄 ${page.title}`,
    page.spaceKey ?? page.spaceId,
    page.status,
    `v${page.version.number}`,
  ];
  if (page.version.createdAt) {
    parts.push(formatDate(page.version.createdAt));
  }
  lines.push(parts.join(' | '));

  // Metadata
  if (page.parentId) {
    lines.push(`Parent: ${page.parentId}`);
  }
  if (page.labels && page.labels.length > 0) {
    lines.push(`Labels: ${page.labels.map(l => l.name).join(', ')}`);
  }

  // Dates
  if (page.createdAt) {
    lines.push(`Created: ${formatDate(page.createdAt)}`);
  }

  // Body (only if expanded)
  if (options?.showBody && page.body?.atlas_doc_format) {
    lines.push('');
    lines.push('---');
    lines.push(''); // Body would be rendered by content layer, not here
    lines.push('[Page body available — use edit_confluence_content for structural editing]');
  }

  return lines.join('\n');
}

export function renderPageList(pages: Page[]): string {
  if (pages.length === 0) return 'No pages found.';

  return pages.map(p => {
    const parts = [
      `📄 ${p.title}`,
      p.spaceKey ?? p.spaceId,
      p.status,
      `v${p.version.number}`,
    ];
    return parts.join(' | ');
  }).join('\n');
}

export function renderSpace(space: Space): string {
  const lines = [
    `🏠 ${space.name} (${space.key}) | ${space.type} | ${space.status}`,
  ];
  if (space.description) {
    lines.push(space.description);
  }
  return lines.join('\n');
}

export function renderSpaceList(spaces: Space[]): string {
  if (spaces.length === 0) return 'No spaces found.';

  return spaces.map(s =>
    `🏠 ${s.name} (${s.key}) | ${s.type} | ${s.status}`
  ).join('\n');
}

export function renderSearchResults(results: SearchResult): string {
  const lines: string[] = [];

  lines.push(`Found ${results.totalSize} result(s)`);
  lines.push('');

  for (const item of results.results) {
    lines.push(`📄 ${item.content.title} | ${item.content.spaceKey ?? item.content.spaceId}`);
    if (item.excerpt) {
      lines.push(`  ${item.excerpt.substring(0, 200)}`);
    }
    lines.push('');
  }

  if (results.cursor) {
    lines.push(`More results available. Use cursor: "${results.cursor}"`);
  }

  return lines.join('\n');
}

export function renderAttachmentList(attachments: Attachment[]): string {
  if (attachments.length === 0) return 'No attachments found.';

  return attachments.map(a =>
    `📎 ${a.title} | ${a.mediaType} | ${formatBytes(a.fileSize)}`
  ).join('\n');
}

export function renderTree(pages: Array<{ page: Page; depth: number }>): string {
  const lines: string[] = [];

  for (const { page, depth } of pages) {
    const indent = depth === 0 ? '' : '│   '.repeat(depth - 1) + '├── ';
    lines.push(`${indent}📄 ${page.title}`);
  }

  lines.push('');
  lines.push(`${pages.length} pages`);

  return lines.join('\n');
}

// ── Helpers ────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
