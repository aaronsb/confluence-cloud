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
  PageComment,
  PaginationOptions,
  PaginatedResponse,
} from '../types/index.js';

// ── REST v2 Implementation ─────────────────────────────────────

/** In-flight cap for per-comment fan-out calls (children, versions), to stay clear of 429s. */
const COMMENT_FANOUT = 5;
/** `POST /users-bulk` rejects more than 250 account ids per call. */
const USERS_BULK_LIMIT = 250;


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
  searchByCql(cql: string, options?: PaginationOptions & { cqlcontext?: Record<string, unknown> }): Promise<SearchResult>;

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

  // Comments
  getComments(pageId: string): Promise<PageComment[]>;
  getCommentLocation(commentId: string): Promise<{ location: 'footer' | 'inline'; pageId?: string } | undefined>;
  addComment(pageId: string, body: object, options?: { parentCommentId?: string; location?: 'footer' | 'inline' }): Promise<PageComment>;

  // Move / Copy
  movePage(id: string, parentId: string): Promise<Page>;
  copyPage(id: string, destinationSpaceId?: string, parentId?: string, title?: string): Promise<Page>;

  // Archive
  archivePage(id: string): Promise<Page>;
  archivePageTree(id: string): Promise<void>;
  unarchivePage(id: string, parentId?: string): Promise<Page>;
}

// ── Client ────────────────────────────────────────────────────

export class ConfluenceRestClient implements ConfluenceClient {
  private baseUrl: string;
  private baseUrlV1: string;
  private cgraphqlUrl: string;
  private headers: Record<string, string>;

  constructor(config: ConfluenceConfig) {
    this.baseUrl = `${config.host}/wiki/api/v2`;
    this.baseUrlV1 = `${config.host}/wiki/rest/api`;
    this.cgraphqlUrl = `${config.host}/cgraphql`;
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
   * Execute a mutation against the Confluence GraphQL gateway (/cgraphql).
   * Uses fetchWithRetry for rate-limit and 5xx protection.
   */
  private async requestCGraphQL<T>(
    operationName: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const results = await this.fetchWithRetry<Array<{ data?: T; errors?: Array<{ message: string }> }>>(
      `${this.cgraphqlUrl}?q=${operationName}`,
      {
        method: 'POST',
        body: JSON.stringify([{ operationName, variables, query }]),
      },
    );
    const result = results[0];
    if (result?.errors?.length) {
      throw new Error(`GraphQL ${operationName}: ${result.errors.map(e => e.message).join('; ')}`);
    }
    return result.data as T;
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

  async searchByCql(cql: string, options?: PaginationOptions & { cqlcontext?: Record<string, unknown> }): Promise<SearchResult> {
    // CQL search is a v1 API endpoint
    const params = new URLSearchParams({ cql });
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.cqlcontext) params.set('cqlcontext', JSON.stringify(options.cqlcontext));
    let raw: ConfluenceV1SearchResponse;
    try {
      raw = await this.requestV1<ConfluenceV1SearchResponse>(
        `/search?${params.toString()}`
      );
    } catch (error) {
      throw cqlError(error, cql);
    }
    const all = raw.results ?? [];
    // v1 search also returns non-content entities (spaces, users) with no
    // `content` object — e.g. `type = space`. Only content hits are mappable.
    const contentHits = all.filter(
      (r): r is typeof r & { content: ConfluenceV1Content } => r.content !== undefined,
    );
    const omittedNonContent = all.length - contentHits.length;
    const hasNext = raw._links?.next !== undefined;
    const totalSize = raw.totalSize ?? all.length;
    // Only declare the whole search a non-content match when this page is the
    // last one and it's entirely non-content. A page that's non-content-only
    // but has more pages behind it (or a totalSize larger than what we've
    // seen) may still turn up content further on — return it with its cursor
    // instead of guessing.
    if (contentHits.length === 0 && all.length > 0 && !hasNext && totalSize <= all.length) {
      const kinds = [...new Set(all.map(r => r.entityType ?? 'non-content'))].join(', ');
      throw new Error(`CQL matched only ${kinds} results; no content in this result set. CQL: ${cql}`);
    }
    return {
      results: contentHits.map(r => ({
        content: mapV1Content(r.content),
        excerpt: r.excerpt,
        lastModified: r.lastModified ?? '',
        url: r.url ?? '',
      })),
      totalSize: raw.totalSize ?? 0,
      cursor: raw._links?.next ? extractCursor(raw._links.next) : undefined,
      omittedNonContent,
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

  // Label WRITES go through the v1 API: the v2 /pages/{id}/labels endpoint is
  // read-only, and POST/DELETE against it return the 405 reported in #16.
  async addLabels(pageId: string, labels: string[]): Promise<void> {
    await this.requestV1(`/content/${pageId}/label`, {
      method: 'POST',
      body: JSON.stringify(labels.map(name => ({ prefix: 'global', name }))),
    });
  }

  async removeLabel(pageId: string, label: string): Promise<void> {
    await this.requestV1(`/content/${pageId}/label?name=${encodeURIComponent(label)}`, { method: 'DELETE' });
  }

  // ── Comments ───────────────────────────────────────────────

  // Comment reads and writes both use v2 (ADR-503). The v1 `/content/{id}/child/comment`
  // endpoint answered in one call but is deprecated (CHANGE-864, removal date passed).
  // v2 costs more round trips: one list per location, one `children` call per comment
  // (replies can nest), one `versions/1` call per edited comment for the original
  // author and date, and one `users-bulk` call per 250 distinct authors for names.
  async getComments(pageId: string): Promise<PageComment[]> {
    const raws: Array<{ raw: ConfluenceV2Comment; location: CommentLocation }> = [];
    for (const location of ['footer', 'inline'] as const) {
      const top = await this.listAllV2<ConfluenceV2Comment>(
        `/pages/${pageId}/${location}-comments`, { 'body-format': 'atlas_doc_format' },
      );
      raws.push(...top.map(raw => ({ raw, location })));
    }

    // Walk reply threads breadth-first; replies inherit their root's location. A failed
    // `children` call is fatal, because a silently dropped thread misrepresents the
    // discussion; the error names the comment whose `children` call failed.
    const seen = new Set(raws.map(r => r.raw.id));
    let frontier = raws;
    while (frontier.length > 0) {
      const batches = await mapWithConcurrency(frontier, COMMENT_FANOUT, ({ raw, location }) =>
        this.listAllV2<ConfluenceV2Comment>(
          `/${location}-comments/${raw.id}/children`, { 'body-format': 'atlas_doc_format' },
        ).then(
          children => children.map(child => ({ raw: child, location })),
          error => {
            throw new Error(`Failed to fetch children of comment ${raw.id}: ${error instanceof Error ? error.message : error}`);
          },
        ),
      );
      frontier = batches.flat().filter(c => !seen.has(c.raw.id));
      for (const c of frontier) seen.add(c.raw.id);
      raws.push(...frontier);
    }

    // `version` on a comment is its latest edit. For edited comments, fetch version 1
    // so the author and date are the original poster's, not the last editor's. A failed
    // lookup falls back to the last editor's author and date, same as a `users-bulk`
    // failure falls back to account ids: the main content is already in hand.
    const originals = new Map<string, ConfluenceV2Version>();
    const edited = raws.filter(r => (r.raw.version?.number ?? 1) > 1);
    await mapWithConcurrency(edited, COMMENT_FANOUT, async ({ raw, location }) => {
      try {
        originals.set(raw.id, await this.request<ConfluenceV2Version>(`/${location}-comments/${raw.id}/versions/1`));
      } catch (error) {
        console.error(`[confluence-cloud] versions/1 failed for comment ${raw.id}; showing last editor. ${error instanceof Error ? error.message : error}`);
      }
    });

    const comments = raws.map(({ raw, location }) => {
      const original = originals.get(raw.id);
      const comment = mapV2Comment(raw, location);
      if (original) {
        comment.author = original.authorId ?? comment.author;
        comment.createdAt = original.createdAt ?? comment.createdAt;
      }
      if (!comment.pageId) comment.pageId = pageId;
      return comment;
    });

    const names = await this.resolveDisplayNames(comments.map(c => c.author));
    for (const c of comments) c.author = names.get(c.author) ?? (c.author || 'Unknown');
    return comments;
  }

  /**
   * Look up a single comment's location and page without reading the whole comment
   * tree. Tries `footer-comments/{id}` first; only on a 404 does it try
   * `inline-comments/{id}`, since a footer comment 404s there. Any other error
   * propagates. Returns `undefined` if the id is neither.
   */
  async getCommentLocation(commentId: string): Promise<{ location: CommentLocation; pageId?: string } | undefined> {
    for (const location of ['footer', 'inline'] as const) {
      try {
        const raw = await this.request<ConfluenceV2Comment>(`/${location}-comments/${commentId}`);
        return { location, pageId: raw.pageId };
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('error 404'))) throw error;
      }
    }
    return undefined;
  }

  /** Follow a v2 list endpoint's `_links.next` cursor until exhausted. */
  private async listAllV2<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | undefined;
    do {
      const qs = new URLSearchParams({ ...params, limit: '100', ...(cursor ? { cursor } : {}) });
      const raw = await this.request<ConfluenceV2PaginatedResponse<T>>(`${path}?${qs}`);
      // An empty page ends the walk even if `next` is set, so a misbehaving
      // cursor cannot loop forever.
      if (raw.results.length === 0) break;
      all.push(...raw.results);
      cursor = raw._links?.next ? extractCursor(raw._links.next) : undefined;
    } while (cursor);
    return all;
  }

  /**
   * Map account ids to display names via `users-bulk` (250 ids per call). A lookup
   * failure degrades to showing account ids rather than failing the whole read.
   */
  private async resolveDisplayNames(accountIds: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const unique = [...new Set(accountIds.filter(Boolean))];
    for (let i = 0; i < unique.length; i += USERS_BULK_LIMIT) {
      try {
        const raw = await this.request<{ results: Array<{ accountId: string; displayName?: string; publicName?: string }> }>(
          '/users-bulk',
          { method: 'POST', body: JSON.stringify({ accountIds: unique.slice(i, i + USERS_BULK_LIMIT) }) },
        );
        for (const u of raw.results ?? []) {
          const name = u.displayName ?? u.publicName;
          if (name) names.set(u.accountId, name);
        }
      } catch (error) {
        console.error(`[confluence-cloud] users-bulk lookup failed; showing account ids. ${error instanceof Error ? error.message : error}`);
      }
    }
    return names;
  }

  async addComment(
    pageId: string,
    body: object,
    options?: { parentCommentId?: string; location?: 'footer' | 'inline' },
  ): Promise<PageComment> {
    const location = options?.location ?? 'footer';
    const raw = await this.request<ConfluenceV2Comment>(`/${location}-comments`, {
      method: 'POST',
      body: JSON.stringify({
        pageId,
        ...(options?.parentCommentId ? { parentCommentId: options.parentCommentId } : {}),
        body: { representation: 'atlas_doc_format', value: JSON.stringify(body) },
      }),
    });
    return mapV2Comment(raw, location);
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

  // ── Move / Copy ──────────────────────────────────────────────

  async movePage(id: string, parentId: string): Promise<Page> {
    await this.requestCGraphQL(
      'MovePageMutation',
      `mutation MovePageMutation($input: MovePageAsChildInput!) {
        movePageAppend(input: $input) { movedPage }
      }`,
      { input: { pageId: id, parentId } },
    );
    return this.getPage(id);
  }

  async copyPage(id: string, destinationSpaceId?: string, parentId?: string, title?: string): Promise<Page> {
    // v1 copy endpoint: POST /content/{id}/copy (no GraphQL equivalent)
    const destination: Record<string, unknown> = { type: 'parent_page' };
    if (parentId) destination.value = parentId;
    if (destinationSpaceId) destination.spaceId = destinationSpaceId;
    const payload: Record<string, unknown> = {
      destination,
      copyAttachments: true,
      copyLabels: true,
      copyProperties: true,
    };
    if (title) payload.pageTitle = title;
    const raw = await this.requestV1<ConfluenceV1Content>(`/content/${id}/copy`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    // Copy returns v1 content — map it
    return mapV1Content(raw);
  }

  // ── Archive ─────────────────────────────────────────────────

  async archivePage(id: string): Promise<Page> {
    const page = await this.getPage(id);
    await this.archiveViaGraphQL([id], false);
    return { ...page, status: 'archived' };
  }

  async archivePageTree(id: string): Promise<void> {
    await this.archiveViaGraphQL([id], true);
  }

  private async archiveViaGraphQL(pageIDs: string[], includeChildren: boolean): Promise<void> {
    await this.requestCGraphQL(
      'ArchivePagesMutation',
      `mutation ArchivePagesMutation($pageIDs: [Long!]!, $includeChildren: [Boolean!]!) {
        bulkArchivePages(pageIDs: $pageIDs, includeChildren: $includeChildren) {
          taskId
          status
        }
      }`,
      { pageIDs, includeChildren: [includeChildren] },
    );
  }

  async unarchivePage(id: string, parentId?: string): Promise<Page> {
    // REST PUT with status=current returns 403 for archived pages — must use GraphQL
    const variables: Record<string, unknown> = {
      pageIDs: [id],
      includeChildren: [false],
    };
    if (parentId) variables.parentPageId = parentId;
    await this.requestCGraphQL(
      'UnarchivePagesMutation',
      `mutation UnarchivePagesMutation($pageIDs: [Long!]!, $includeChildren: [Boolean!]!, $parentPageId: Long) {
        bulkUnarchivePages(pageIDs: $pageIDs, includeChildren: $includeChildren, parentPageId: $parentPageId) {
          taskId
          status
        }
      }`,
      variables,
    );
    // Unarchive is async — poll until page status is 'current'
    const maxAttempts = 10;
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(500);
      try {
        const page = await this.getPage(id);
        if (page.status === 'current') return page;
      } catch {
        // Page may not be visible yet during transition
      }
    }
    // Best-effort: return whatever state we can get
    return this.getPage(id);
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

type CommentLocation = 'footer' | 'inline';

interface ConfluenceV2Comment {
  id: string;
  pageId?: string;
  parentCommentId?: string;
  body?: { atlas_doc_format?: { value: string } };
  version?: ConfluenceV2Version;
  resolutionStatus?: string;
  properties?: {
    inlineOriginalSelection?: string;
    'inline-original-selection'?: string;
  };
}

interface ConfluenceV2Version {
  number?: number;
  createdAt?: string;
  authorId?: string;
}

interface ConfluenceV2PaginatedResponse<T = ConfluenceV2Page> {
  results: T[];
  _links?: { next?: string };
}

// v1 search response has different content shape
interface ConfluenceV1SearchResponse {
  results: Array<{
    content?: ConfluenceV1Content;
    entityType?: string;
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

function parseAdfValue(value: string | undefined): PageComment['body'] {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function mapV2Comment(raw: ConfluenceV2Comment, location: CommentLocation): PageComment {
  return {
    id: raw.id,
    pageId: raw.pageId ?? '',
    location,
    parentId: raw.parentCommentId,
    author: raw.version?.authorId ?? '',
    createdAt: raw.version?.createdAt ?? '',
    body: parseAdfValue(raw.body?.atlas_doc_format?.value),
    resolutionStatus: raw.resolutionStatus as PageComment['resolutionStatus'],
    inlineSelection: raw.properties?.inlineOriginalSelection ?? raw.properties?.['inline-original-selection'],
  };
}

function mapContentProperty(raw: ConfluenceV2ContentProperty): ContentProperty {
  return {
    key: raw.key,
    value: raw.value,
    version: { number: raw.version?.number ?? 1, createdAt: raw.version?.createdAt },
  };
}

/**
 * Rewrap a failed CQL search so the caller sees Confluence's own diagnostic
 * (the `message` field of the error body) rather than a raw JSON dump.
 */
function cqlError(error: unknown, cql: string): Error {
  const text = error instanceof Error ? error.message : String(error);
  const match = /^Confluence API error 400: ([\s\S]*)$/.exec(text);
  if (!match) return error instanceof Error ? error : new Error(text);
  let detail = match[1];
  try {
    const body = JSON.parse(match[1]) as { message?: string };
    // Confluence's own diagnostic is often prefixed with the fully-qualified
    // Java exception class (e.g. `com.atlassian...BadRequestException: `) —
    // strip it so the caller sees the human-readable part only.
    if (body.message) detail = body.message.replace(/^(?:[\w$]+\.)+[\w$]*Exception:\s*/, '');
  } catch { /* non-JSON body — use it verbatim */ }
  return new Error(`Invalid CQL: ${detail}. CQL: ${cql}`);
}

/** Run `fn` over `items` with at most `limit` calls in flight, preserving order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function extractCursor(nextLink: string): string | undefined {
  try {
    const url = new URL(nextLink, 'https://placeholder.com');
    return url.searchParams.get('cursor') ?? undefined;
  } catch {
    return undefined;
  }
}
