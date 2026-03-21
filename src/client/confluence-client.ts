/**
 * Confluence Cloud client — abstracts REST v2 and GraphQL transports.
 * See ADR-200: Hybrid REST and GraphQL Client.
 */

import { MAX_RETRIES, sleep, parseRetryAfter, isRetryable } from './retry-utils.js';
import type {
  ConfluenceConfig,
  Page,
  Space,
  SearchResult,
  Attachment,
  ContentProperty,
  PaginationOptions,
  PaginatedResponse,
} from '../types/index.js';

// ── REST v2 Implementation ─────────────────────────────────────


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
  getAttachmentInfo(id: string): Promise<Attachment>;
  downloadAttachment(id: string): Promise<Buffer>;
  uploadAttachment(pageId: string, filename: string, content: Buffer, mediaType: string): Promise<Attachment>;
  deleteAttachment(id: string): Promise<void>;

  // Labels
  getLabels(pageId: string): Promise<string[]>;
  addLabel(pageId: string, label: string): Promise<void>;
  addLabels(pageId: string, labels: string[]): Promise<void>;
  removeLabel(pageId: string, label: string): Promise<void>;

  // Content Properties
  getProperties(pageId: string): Promise<ContentProperty[]>;
  getProperty(pageId: string, key: string): Promise<ContentProperty>;
  setProperty(pageId: string, key: string, value: Record<string, unknown>): Promise<ContentProperty>;
  deleteProperty(pageId: string, key: string): Promise<void>;
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
    const mergedHeaders = { ...this.headers, ...options?.headers } as Record<string, string>;
    // FormData sets Content-Type with multipart boundary automatically — don't override it
    if (options?.body instanceof FormData) {
      delete mergedHeaders['Content-Type'];
    }
    const response = await fetch(url, {
      ...options,
      headers: mergedHeaders,
    });

    // Retryable status — backoff with jitter, respect Retry-After
    if (isRetryable(response.status) && attempt < MAX_RETRIES) {
      const delayMs = parseRetryAfter(response.headers.get('Retry-After'), attempt);
      console.error(`[confluence-cloud] HTTP ${response.status}. Retrying in ${Math.round(delayMs)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await response.text(); // drain body to release socket
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

  async getAttachmentInfo(id: string): Promise<Attachment> {
    const raw = await this.request<ConfluenceV2Attachment>(`/attachments/${id}`);
    return mapAttachment(raw);
  }

  async downloadAttachment(id: string): Promise<Buffer> {
    const info = await this.getAttachmentInfo(id);
    if (!info.downloadUrl) {
      throw new Error(`Attachment ${id} has no download URL`);
    }
    // Download URL is relative to the wiki root (e.g., /download/attachments/...)
    const host = this.baseUrl.replace('/wiki/api/v2', '');
    let url: string;
    if (info.downloadUrl.startsWith('http')) {
      // Validate origin matches configured host to prevent SSRF
      const parsed = new URL(info.downloadUrl);
      const expected = new URL(host);
      if (parsed.origin !== expected.origin) {
        throw new Error(`Attachment download URL origin mismatch: ${parsed.origin} !== ${expected.origin}`);
      }
      url = info.downloadUrl;
    } else {
      url = `${host}/wiki${info.downloadUrl}`;
    }
    const response = await fetch(url, {
      headers: { 'Authorization': this.headers['Authorization'] },
    });
    if (!response.ok) {
      throw new Error(`Failed to download attachment ${id}: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async uploadAttachment(pageId: string, filename: string, content: Buffer, mediaType: string): Promise<Attachment> {
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(content)], { type: mediaType }), filename);

    // Use v1 endpoint — v2 attachment creation is unreliable
    const raw = await this.requestV1<{ results: ConfluenceV1Attachment[] }>(`/content/${pageId}/child/attachment`, {
      method: 'POST',
      headers: {
        'Authorization': this.headers['Authorization'],
        'Accept': 'application/json',
        'X-Atlassian-Token': 'nocheck',
      },
      body: formData as unknown as BodyInit,
    });
    const att = raw.results[0];
    return {
      id: att.id,
      title: att.title,
      mediaType: att.metadata?.mediaType || mediaType,
      fileSize: att.extensions?.fileSize ? Number(att.extensions.fileSize) : content.length,
      downloadUrl: att._links?.download || '',
      pageId,
      version: att.version?.number || 1,
      createdAt: att.version?.when || '',
    };
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
    await this.addLabels(pageId, [label]);
  }

  async addLabels(pageId: string, labels: string[]): Promise<void> {
    await this.request(`/pages/${pageId}/labels`, {
      method: 'POST',
      body: JSON.stringify(labels.map(name => ({ prefix: 'global', name }))),
    });
  }

  async removeLabel(pageId: string, label: string): Promise<void> {
    await this.request(`/pages/${pageId}/labels/${encodeURIComponent(label)}`, { method: 'DELETE' });
  }

  // ── Content Properties ──────────────────────────────────────

  async getProperties(pageId: string): Promise<ContentProperty[]> {
    const raw = await this.request<ConfluenceV2PaginatedResponse<ConfluenceV2ContentProperty>>(
      `/pages/${pageId}/properties`,
    );
    return raw.results.map(mapContentProperty);
  }

  async getProperty(pageId: string, key: string): Promise<ContentProperty> {
    const raw = await this.request<ConfluenceV2ContentProperty>(
      `/pages/${pageId}/properties/${encodeURIComponent(key)}`,
    );
    return mapContentProperty(raw);
  }

  async setProperty(pageId: string, key: string, value: Record<string, unknown>): Promise<ContentProperty> {
    // Upsert: try to get existing property for version, then PUT; if not found, POST to create.
    // Note: GET-then-PUT has a small race window for concurrent edits — acceptable per ADR-501.
    const encodedKey = encodeURIComponent(key);
    try {
      const existing = await this.request<ConfluenceV2ContentProperty>(
        `/pages/${pageId}/properties/${encodedKey}`,
      );
      const raw = await this.request<ConfluenceV2ContentProperty>(
        `/pages/${pageId}/properties/${encodedKey}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            key,
            value,
            version: { number: (existing.version?.number ?? 0) + 1 },
          }),
        },
      );
      return mapContentProperty(raw);
    } catch (err) {
      // Property doesn't exist — create it
      if (err instanceof Error && err.message.includes('404')) {
        const raw = await this.request<ConfluenceV2ContentProperty>(
          `/pages/${pageId}/properties`,
          {
            method: 'POST',
            body: JSON.stringify({ key, value }),
          },
        );
        return mapContentProperty(raw);
      }
      throw err;
    }
  }

  async deleteProperty(pageId: string, key: string): Promise<void> {
    await this.request(`/pages/${pageId}/properties/${encodeURIComponent(key)}`, { method: 'DELETE' });
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

interface ConfluenceV1Attachment {
  id: string;
  title: string;
  metadata?: { mediaType?: string };
  extensions?: { fileSize?: string };
  version?: { number: number; when?: string };
  _links?: { download?: string };
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

interface ConfluenceV2ContentProperty {
  key: string;
  value: Record<string, unknown>;
  version?: { number: number; createdAt?: string };
}

interface ConfluenceV2PaginatedResponse<T = ConfluenceV2Page> {
  results: T[];
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

function mapContentProperty(raw: ConfluenceV2ContentProperty): ContentProperty {
  return {
    key: raw.key,
    value: raw.value,
    version: { number: raw.version?.number ?? 1, createdAt: raw.version?.createdAt },
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
