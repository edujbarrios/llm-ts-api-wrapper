/**
 * llm7-wrapper — Retry utility with exponential back-off + jitter
 * Author: Eduardo J. Barrios <edujbarrios@outlook.com>
 */

import { RetryOptions } from "../types";
import {
  LLMRateLimitError,
  LLMServerError,
  LLMNetworkError,
  LLMTimeoutError,
} from "../errors";

const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

/**
 * Sleep for `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential back-off with ±10 % jitter.
 * attempt is 0-indexed (first retry = attempt 0).
 */
function backoffDelay(baseMs: number, attempt: number): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = exponential * 0.1 * (Math.random() * 2 - 1);
  return Math.round(exponential + jitter);
}

/**
 * Returns true if the error is considered transient and worth retrying.
 */
function isRetryable(
  err: unknown,
  retryableStatuses: number[]
): boolean {
  if (err instanceof LLMRateLimitError) return true;
  if (err instanceof LLMServerError) return retryableStatuses.includes(err.status);
  if (err instanceof LLMNetworkError) return true;
  if (err instanceof LLMTimeoutError) return true;
  return false;
}

/**
 * Execute `fn` with automatic retries on transient failures.
 *
 * @param fn      Async factory that produces a value of type T
 * @param options Retry configuration
 * @returns       The resolved value of `fn`
 * @throws        The last error encountered after exhausting all retries
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const retryableStatuses =
    options.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES;

  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const isLastAttempt = attempt === options.maxRetries;
      if (isLastAttempt || !isRetryable(err, retryableStatuses)) {
        throw err;
      }

      const delay = backoffDelay(options.backoffMs, attempt);
      await sleep(delay);
    }
  }

  // Unreachable in practice, but satisfies TypeScript
  throw lastError;
}
