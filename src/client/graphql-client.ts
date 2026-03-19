/**
 * Atlassian GraphQL gateway client.
 * See ADR-200: Hybrid REST and GraphQL Client.
 */

const AGG_ENDPOINT = 'https://api.atlassian.com/graphql';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
  const base = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  return base + Math.random() * base * 0.5;
}

function buildAuthHeader(email: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
}

function extractHostname(host: string): string {
  return host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

/**
 * Discover the Atlassian cloudId for a given host.
 */
export async function discoverCloudId(
  host: string,
  email: string,
  apiToken: string,
): Promise<string | null> {
  const hostname = extractHostname(host);

  try {
    const response = await fetch(AGG_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': buildAuthHeader(email, apiToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `query GetTenant($hostNames: [String!]!) { tenantContexts(hostNames: $hostNames) { cloudId } }`,
        variables: { hostNames: [hostname] },
      }),
    });

    if (!response.ok) return null;

    const result = await response.json() as GraphQLResponse<{ tenantContexts: Array<{ cloudId: string }> }>;
    return result.data?.tenantContexts?.[0]?.cloudId ?? null;
  } catch {
    return null;
  }
}

/**
 * GraphQL client for the Atlassian gateway.
 */
export class GraphQLClient {
  private authHeader: string;
  private cloudId: string;
  private siteAri: string;

  constructor(email: string, apiToken: string, cloudId: string) {
    this.authHeader = buildAuthHeader(email, apiToken);
    this.cloudId = cloudId;
    this.siteAri = `ari:cloud:platform::site/${cloudId}`;
  }

  getCloudId(): string {
    return this.cloudId;
  }

  buildPageAri(pageId: string): string {
    return `ari:cloud:confluence:${this.cloudId}:page/${pageId}`;
  }

  async query<T>(
    queryText: string,
    variables: Record<string, unknown> = {},
    attempt = 0,
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
      const response = await fetch(AGG_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json',
          'X-Query-Context': this.siteAri,
        },
        body: JSON.stringify({ query: queryText, variables }),
      });

      // Rate limited or server error — retry with jittered backoff
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : backoffDelay(attempt);
        console.error(`[confluence-cloud] GraphQL ${response.status}. Retrying in ${Math.round(delayMs)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delayMs);
        return this.query<T>(queryText, variables, attempt + 1);
      }

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const result = await response.json() as GraphQLResponse<T>;

      if (result.errors?.length) {
        return { success: false, error: result.errors.map(e => e.message).join('; ') };
      }

      return { success: true, data: result.data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Get pages linking TO a Confluence page (backlinks).
   */
  async getIncomingLinks(pageId: string): Promise<{ pageIds: string[]; hasMore: boolean }> {
    const pageAri = this.buildPageAri(pageId);

    const result = await this.query<{
      linksIncomingToConfluencePage: CypherQueryConnection;
    }>(`query GetBacklinks($pageId: ID!) {
      linksIncomingToConfluencePage(pageId: $pageId) {
        pageInfo { hasNextPage }
        queryResult {
          columns
          rows { rowItems { key value { id } } }
        }
      }
    }`, { pageId: pageAri });

    if (!result.success || !result.data) return { pageIds: [], hasMore: false };
    const conn = result.data.linksIncomingToConfluencePage;
    return {
      pageIds: extractPageIdsFromRows(conn),
      hasMore: conn.pageInfo?.hasNextPage ?? false,
    };
  }

  /**
   * Get pages linked FROM a Confluence page (forward links).
   */
  async getOutgoingLinks(pageId: string): Promise<{ pageIds: string[]; hasMore: boolean }> {
    const pageAri = this.buildPageAri(pageId);

    const result = await this.query<{
      linksOutgoingFromConfluencePage: CypherQueryConnection;
    }>(`query GetForwardLinks($pageId: ID!) {
      linksOutgoingFromConfluencePage(pageId: $pageId) {
        pageInfo { hasNextPage }
        queryResult {
          columns
          rows { rowItems { key value { id } } }
        }
      }
    }`, { pageId: pageAri });

    if (!result.success || !result.data) return { pageIds: [], hasMore: false };
    const conn = result.data.linksOutgoingFromConfluencePage;
    return {
      pageIds: extractPageIdsFromRows(conn),
      hasMore: conn.pageInfo?.hasNextPage ?? false,
    };
  }
}

// ── Types ──────────────────────────────────────────────────────

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface CypherQueryConnection {
  pageInfo?: { hasNextPage: boolean };
  queryResult: {
    columns: string[];
    rows: Array<{
      rowItems: Array<{
        key: string;
        value: Array<{ id: string }>;
      }>;
    }>;
  };
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Extract Confluence page IDs from GraphStore cypher query rows.
 * ARIs look like: ari:cloud:confluence:<cloudId>:page/<pageId>
 */
function extractPageIdsFromRows(connection: CypherQueryConnection): string[] {
  const pageIds: string[] = [];

  for (const row of connection.queryResult.rows) {
    for (const item of row.rowItems) {
      for (const val of item.value) {
        const match = val.id.match(/:page\/(\d+)$/);
        if (match) {
          pageIds.push(match[1]);
        }
      }
    }
  }

  return pageIds;
}
