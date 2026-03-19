import { describe, it, expect } from 'vitest';
import { backoffDelay, parseRetryAfter, isRetryable, MAX_RETRY_DELAY_MS } from './retry-utils.js';

describe('retry-utils', () => {
  describe('backoffDelay', () => {
    it('should produce values within expected ceiling', () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const ceiling = 1000 * Math.pow(2, attempt); // INITIAL_BACKOFF_MS * 2^attempt
        for (let i = 0; i < 20; i++) {
          const delay = backoffDelay(attempt);
          expect(delay).toBeGreaterThanOrEqual(0);
          expect(delay).toBeLessThanOrEqual(ceiling);
        }
      }
    });

    it('should return non-negative values', () => {
      for (let i = 0; i < 100; i++) {
        expect(backoffDelay(i % 5)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('parseRetryAfter', () => {
    it('should parse numeric Retry-After headers', () => {
      const delay = parseRetryAfter('5', 0);
      expect(delay).toBe(5000);
    });

    it('should cap at MAX_RETRY_DELAY_MS', () => {
      const delay = parseRetryAfter('999', 0);
      expect(delay).toBe(MAX_RETRY_DELAY_MS);
    });

    it('should fall back to backoff for NaN headers', () => {
      const delay = parseRetryAfter('Thu, 20 Mar 2026 12:00:00 GMT', 0);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(1000); // attempt 0 ceiling
    });

    it('should fall back to backoff for null headers', () => {
      const delay = parseRetryAfter(null, 1);
      expect(delay).toBeGreaterThanOrEqual(0);
    });

    it('should fall back for zero or negative values', () => {
      const delay = parseRetryAfter('0', 0);
      expect(delay).toBeGreaterThanOrEqual(0); // falls back to backoff
    });
  });

  describe('isRetryable', () => {
    it('should return true for 429', () => {
      expect(isRetryable(429)).toBe(true);
    });

    it('should return true for 500+', () => {
      expect(isRetryable(500)).toBe(true);
      expect(isRetryable(502)).toBe(true);
      expect(isRetryable(503)).toBe(true);
    });

    it('should return false for 4xx (except 429)', () => {
      expect(isRetryable(400)).toBe(false);
      expect(isRetryable(401)).toBe(false);
      expect(isRetryable(404)).toBe(false);
    });

    it('should return false for 2xx', () => {
      expect(isRetryable(200)).toBe(false);
      expect(isRetryable(204)).toBe(false);
    });
  });
});
