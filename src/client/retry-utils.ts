/**
 * Shared retry utilities for REST and GraphQL clients.
 */

export const MAX_RETRIES = 3;
export const INITIAL_BACKOFF_MS = 1000;
export const MAX_RETRY_DELAY_MS = 60_000;

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Full jitter exponential backoff.
 * Range: [0, base * 2^attempt] — spreads retries evenly to prevent thundering herd.
 */
export function backoffDelay(attempt: number): number {
  const ceiling = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  return Math.random() * ceiling;
}

/**
 * Parse Retry-After header safely.
 * Returns delay in ms, capped at MAX_RETRY_DELAY_MS.
 * Falls back to exponential backoff if header is missing, non-numeric, or unreasonable.
 */
export function parseRetryAfter(header: string | null, attempt: number): number {
  if (header) {
    const parsed = parseInt(header, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed * 1000, MAX_RETRY_DELAY_MS);
    }
  }
  return backoffDelay(attempt);
}

/**
 * Determine if a response status is retryable.
 */
export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}
