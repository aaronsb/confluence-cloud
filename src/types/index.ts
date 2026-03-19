/**
 * Shared TypeScript types for the Confluence Cloud MCP server.
 */

// ── Tool Response ──────────────────────────────────────────────

export interface ToolResponse {
  [key: string]: unknown;
  content: ToolContent[];
  isError?: boolean;
}

export interface ToolContent {
  type: 'text' | 'image';
  text?: string;
  data?: string;
  mimeType?: string;
}

// ── Confluence Entities ────────────────────────────────────────

export interface Page {
  id: string;
  title: string;
  spaceId: string;
  spaceKey?: string;
  status: 'current' | 'draft' | 'archived' | 'trashed';
  parentId?: string;
  version: PageVersion;
  createdAt: string;
  authorId: string;
  body?: PageBody;
  labels?: Label[];
  excerpt?: string;
}

export interface PageVersion {
  number: number;
  message?: string;
  createdAt: string;
  authorId: string;
}

export interface PageBody {
  /** Parsed ADF document from Confluence API */
  atlas_doc_format?: AdfDocument;
  /** Storage format (XHTML, legacy) */
  storage?: string;
}

/** Minimal ADF document shape for type safety */
export interface AdfDocument {
  type: string;
  content?: unknown[];
  [key: string]: unknown;
}

export interface Space {
  id: string;
  key: string;
  name: string;
  type: 'global' | 'personal';
  status: 'current' | 'archived';
  description?: string;
  homepageId?: string;
}

export interface Label {
  id: string;
  name: string;
  prefix: 'global' | 'my';
}

export interface Attachment {
  id: string;
  title: string;
  mediaType: string;
  fileSize: number;
  downloadUrl: string;
  pageId: string;
  version: number;
  createdAt: string;
}

export interface SearchResult {
  results: SearchResultItem[];
  totalSize: number;
  cursor?: string;
}

export interface SearchResultItem {
  content: Page;
  excerpt?: string;
  lastModified: string;
  url: string;
}

// ── Pagination ─────────────────────────────────────────────────

export interface PaginationOptions {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResponse<T> {
  results: T[];
  cursor?: string;
  totalSize?: number;
}

// ── Configuration ──────────────────────────────────────────────

export interface ConfluenceConfig {
  host: string;
  email: string;
  apiToken: string;
}
