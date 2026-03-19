/**
 * Confluence Cloud client — abstracts REST v2 and GraphQL transports.
 * See ADR-200: Hybrid REST and GraphQL Client.
 */

import type {
  ConfluenceConfig,
  Page,
  Space,
  SearchResult,
  Attachment,
  PaginationOptions,
  PaginatedResponse,
} from '../types/index.js';

// ── Client Interface ───────────────────────────────────────────

export interface ConfluenceClient {
  // Pages
  getPage(id: string, expand?: string[]): Promise<Page>;
  createPage(spaceId: string, title: string, body?: object, parentId?: string): Promise<Page>;
  updatePage(id: string, title: string | undefined, body: object, version: number, message?: string): Promise<Page>;
  deletePage(id: string): Promise<void>;

  // Page hierarchy
  getChildren(pageId: string, options?: PaginationOptions): Promise<PaginatedResponse<Page>>;
  getAncestors(pageId: string): Promise<Page[]>;

  // Spaces
  getSpace(id: string): Promise<Space>;
  listSpaces(options?: PaginationOptions): Promise<PaginatedResponse<Space>>;

  // Search
  searchByCql(cql: string, options?: PaginationOptions): Promise<SearchResult>;

  // Attachments
  getAttachments(pageId: string, options?: PaginationOptions): Promise<PaginatedResponse<Attachment>>;
  uploadAttachment(pageId: string, filename: string, content: Buffer, mediaType: string): Promise<Attachment>;
  deleteAttachment(id: string): Promise<void>;

  // Labels
  getLabels(pageId: string): Promise<string[]>;
  addLabel(pageId: string, label: string): Promise<void>;
  removeLabel(pageId: string, label: string): Promise<void>;
}

// ── REST v2 Implementation ─────────────────────────────────────

// ── Rate Limiting ─────────────────────────────────────────────

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter to prevent thundering herd. */
function backoffDelay(attempt: number): number {
  const base = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = Math.random() * base * 0.5; // 0-50% jitter
  return base + jitter;
}

// ── Client ────────────────────────────────────────────────────

export class ConfluenceRestClient implements ConfluenceClient {
  private baseUrl: string;
  private baseUrlV1: string;
  private headers: Record<string, string>;

  constructor(config: ConfluenceConfig) {
    this.baseUrl = `${config.host}/wiki/api/v2`;
    this.baseUrlV1 = `${config.host}/wiki/rest/api`;
    this.headers = {
      'Authorization': `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    return this.fetchWithRetry<T>(`${this.baseUrl}${path}`, options);
  }

  private async requestV1<T>(path: string, options?: RequestInit): Promise<T> {
    return this.fetchWithRetry<T>(`${this.baseUrlV1}${path}`, options);
  }

  /**
   * Fetch with exponential backoff on 429 (rate limit) and 5xx (server errors).
   * Respects Retry-After header when present.
   */
  private async fetchWithRetry<T>(url: string, options?: RequestInit, attempt = 0): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: { ...this.headers, ...options?.headers },
    });

    // Rate limited — respect Retry-After or use exponential backoff with jitter
    if (response.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = response.headers.get('Retry-After');
      const delayMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : backoffDelay(attempt);
      console.error(`[confluence-cloud] Rate limited (429). Retrying in ${Math.round(delayMs)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(delayMs);
      return this.fetchWithRetry<T>(url, options, attempt + 1);
    }

    // Server error — retry with jittered backoff (may be transient)
    if (response.status >= 500 && attempt < MAX_RETRIES) {
      const delayMs = backoffDelay(attempt);
      console.error(`[confluence-cloud] Server error (${response.status}). Retrying in ${Math.round(delayMs)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(delayMs);
      return this.fetchWithRetry<T>(url, options, attempt + 1);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Confluence API error ${response.status}: ${body}`);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  // ── Pages ──────────────────────────────────────────────────

  async getPage(id: string, expand?: string[]): Promise<Page> {
    const params = new URLSearchParams();
    if (expand?.includes('body')) params.set('body-format', 'atlas_doc_format');
    const qs = params.toString();
    const raw = await this.request<ConfluenceV2Page>(`/pages/${id}${qs ? `?${qs}` : ''}`);
    return mapPage(raw);
  }

  async createPage(spaceId: string, title: string, body?: object, parentId?: string): Promise<Page> {
    const payload: Record<string, unknown> = {
      spaceId,
      title,
      status: 'current',
    };
    if (parentId) payload.parentId = parentId;
    if (body) {
      payload.body = {
        representation: 'atlas_doc_format',
        value: JSON.stringify(body),
      };
    }
    const raw = await this.request<ConfluenceV2Page>('/pages', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return mapPage(raw);
  }

  async updatePage(id: string, title: string | undefined, body: object, version: number, message?: string): Promise<Page> {
    // If title not provided, fetch current title
    let pageTitle = title;
    if (!pageTitle) {
      const current = await this.request<ConfluenceV2Page>(`/pages/${id}`);
      pageTitle = current.title;
    }

    const payload = {
      id,
      title: pageTitle,
      status: 'current',
      body: {
        representation: 'atlas_doc_format',
        value: JSON.stringify(body),
      },
      version: {
        number: version + 1,
        message: message ?? '',
      },
    };
    const raw = await this.request<ConfluenceV2Page>(`/pages/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return mapPage(raw);
  }

  async deletePage(id: string): Promise<void> {
    await this.request(`/pages/${id}`, { method: 'DELETE' });
  }

  // ── Hierarchy ──────────────────────────────────────────────

  async getChildren(pageId: string, options?: PaginationOptions): Promise<PaginatedResponse<Page>> {
    const params = new URLSearchParams();
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    const raw = await this.request<ConfluenceV2PaginatedResponse<ConfluenceV2Page>>(`/pages/${pageId}/children${qs ? `?${qs}` : ''}`);
    return {
      results: raw.results.map(mapPage),
      cursor: raw._links?.next ? extractCursor(raw._links.next) : undefined,
    };
  }

  async getAncestors(pageId: string): Promise<Page[]> {
    const raw = await this.request<{ results: Array<{ id: string; type: string }> }>(`/pages/${pageId}/ancestors`);
    // v2 ancestors returns only IDs — fetch each page for details
    const pages: Page[] = [];
    for (const ancestor of raw.results) {
      try {
        const page = await this.getPage(ancestor.id);
        pages.push(page);
      } catch {
        // Ancestor may be inaccessible
      }
    }
    return pages;
  }

  // ── Spaces ─────────────────────────────────────────────────

  async getSpace(id: string): Promise<Space> {
    const raw = await this.request<ConfluenceV2Space>(`/spaces/${id}`);
    return mapSpace(raw);
  }

  async listSpaces(options?: PaginationOptions): Promise<PaginatedResponse<Space>> {
    const params = new URLSearchParams();
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    const raw = await this.request<ConfluenceV2PaginatedResponse<ConfluenceV2Space>>(`/spaces${qs ? `?${qs}` : ''}`);
    return {
      results: raw.results.map(mapSpace),
      cursor: raw._links?.next ? extractCursor(raw._links.next) : undefined,
    };
  }

  // ── Search ─────────────────────────────────────────────────

  async searchByCql(cql: string, options?: PaginationOptions): Promise<SearchResult> {
    // CQL search is a v1 API endpoint
    const params = new URLSearchParams({ cql });
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.limit) params.set('limit', String(options.limit));
    const raw = await this.requestV1<ConfluenceV1SearchResponse>(
      `/search?${params.toString()}`
    );
    return {
      results: (raw.results ?? []).map(r => ({
        content: mapV1Content(r.content),
        excerpt: r.excerpt,
        lastModified: r.lastModified ?? '',
        url: r.url ?? '',
      })),
      totalSize: raw.totalSize ?? 0,
      cursor: raw._links?.next ? extractCursor(raw._links.next) : undefined,
    };
  }

  // ── Attachments ────────────────────────────────────────────

  async getAttachments(pageId: string, options?: PaginationOptions): Promise<PaginatedResponse<Attachment>> {
    const params = new URLSearchParams();
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    const raw = await this.request<ConfluenceV2PaginatedResponse<ConfluenceV2Attachment>>(`/pages/${pageId}/attachments${qs ? `?${qs}` : ''}`);
    return {
      results: raw.results.map(mapAttachment),
      cursor: raw._links?.next ? extractCursor(raw._links.next) : undefined,
    };
  }

  async uploadAttachment(pageId: string, filename: string, content: Buffer, mediaType: string): Promise<Attachment> {
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(content)], { type: mediaType }), filename);

    const raw = await this.request<ConfluenceV2Attachment>(`/pages/${pageId}/attachments`, {
      method: 'POST',
      headers: {
        'Authorization': this.headers['Authorization'],
        'X-Atlassian-Token': 'nocheck',
      },
      body: formData as unknown as BodyInit,
    });
    return mapAttachment(raw);
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.request(`/attachments/${id}`, { method: 'DELETE' });
  }

  // ── Labels ─────────────────────────────────────────────────

  async getLabels(pageId: string): Promise<string[]> {
    const raw = await this.request<{ results: Array<{ name: string }> }>(`/pages/${pageId}/labels`);
    return raw.results.map(l => l.name);
  }

  async addLabel(pageId: string, label: string): Promise<void> {
    await this.request(`/pages/${pageId}/labels`, {
      method: 'POST',
      body: JSON.stringify([{ prefix: 'global', name: label }]),
    });
  }

  async removeLabel(pageId: string, label: string): Promise<void> {
    await this.request(`/pages/${pageId}/labels/${label}`, { method: 'DELETE' });
  }
}

// ── V2 API Response Types (internal) ───────────────────────────

interface ConfluenceV2Page {
  id: string;
  title: string;
  spaceId: string;
  status: string;
  parentId?: string;
  version?: { number: number; message?: string; createdAt: string; authorId: string };
  createdAt?: string;
  authorId?: string;
  body?: { atlas_doc_format?: { value: string } };
  _links?: Record<string, string>;
}

interface ConfluenceV2Space {
  id: string;
  key: string;
  name: string;
  type: string;
  status: string;
  description?: { plain?: { value: string } };
  homepageId?: string;
}

interface ConfluenceV2Attachment {
  id: string;
  title: string;
  mediaType: string;
  fileSize: number;
  downloadLink?: string;
  pageId?: string;
  version?: { number: number };
  createdAt?: string;
}

interface ConfluenceV2PaginatedResponse<T = ConfluenceV2Page> {
  results: T[];
  _links?: { next?: string };
}

interface ConfluenceV2SearchResponse {
  results: Array<{
    content: ConfluenceV2Page;
    excerpt?: string;
    lastModified?: string;
    url?: string;
  }>;
  totalSize?: number;
  _links?: { next?: string };
}

// v1 search response has different content shape
interface ConfluenceV1SearchResponse {
  results: Array<{
    content: ConfluenceV1Content;
    excerpt?: string;
    lastModified?: string;
    url?: string;
  }>;
  totalSize?: number;
  _links?: { next?: string };
}

interface ConfluenceV1Content {
  id: string;
  title: string;
  type: string;
  status: string;
  _expandable?: Record<string, string>;
  space?: { key: string; id: number };
  version?: { number: number; when: string; by?: { accountId?: string; displayName: string } };
}

// ── Mappers ────────────────────────────────────────────────────

function mapPage(raw: ConfluenceV2Page): Page {
  const r = raw;
  let body: Page['body'] | undefined;
  if (r.body?.atlas_doc_format?.value) {
    try {
      body = { atlas_doc_format: JSON.parse(r.body.atlas_doc_format.value) };
    } catch {
      body = { atlas_doc_format: undefined };
    }
  }

  return {
    id: r.id,
    title: r.title,
    spaceId: r.spaceId,
    status: r.status as Page['status'],
    parentId: r.parentId,
    version: r.version ?? { number: 1, createdAt: '', authorId: '' },
    createdAt: r.createdAt ?? '',
    authorId: r.authorId ?? '',
    body,
  };
}

function mapSpace(raw: ConfluenceV2Space): Space {
  const r = raw;
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    type: r.type as Space['type'],
    status: r.status as Space['status'],
    description: r.description?.plain?.value,
    homepageId: r.homepageId,
  };
}

function mapAttachment(raw: ConfluenceV2Attachment): Attachment {
  const r = raw;
  return {
    id: r.id,
    title: r.title,
    mediaType: r.mediaType,
    fileSize: r.fileSize,
    downloadUrl: r.downloadLink ?? '',
    pageId: r.pageId ?? '',
    version: r.version?.number ?? 1,
    createdAt: r.createdAt ?? '',
  };
}

function mapV1Content(raw: ConfluenceV1Content): Page {
  return {
    id: raw.id,
    title: raw.title,
    spaceId: raw.space?.id?.toString() ?? '',
    spaceKey: raw.space?.key,
    status: (raw.status as Page['status']) ?? 'current',
    version: {
      number: raw.version?.number ?? 1,
      createdAt: raw.version?.when ?? '',
      authorId: raw.version?.by?.accountId ?? raw.version?.by?.displayName ?? '',
    },
    createdAt: raw.version?.when ?? '',
    authorId: raw.version?.by?.accountId ?? raw.version?.by?.displayName ?? '',
  };
}

function extractCursor(nextLink: string): string | undefined {
  try {
    const url = new URL(nextLink, 'https://placeholder.com');
    return url.searchParams.get('cursor') ?? undefined;
  } catch {
    return undefined;
  }
}
