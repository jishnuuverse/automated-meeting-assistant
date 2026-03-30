'use strict';

/**
 * Generic retry utility with exponential backoff.
 *
 * Only retries on network errors or 5xx server errors.
 * 4xx errors (bad API key, invalid request) are NOT retried.
 *
 * @param {Function} fn          - Async function to execute.
 * @param {number}   maxRetries  - Maximum number of retries (default: 3).
 * @param {number}   baseDelayMs - Base delay in ms (default: 1000). Doubles each retry.
 * @returns {Promise<*>}         - Result of fn().
 */
async function withRetry(fn, maxRetries = 3, baseDelayMs = 1000) {
  let lastError;
  let attempts = 0;

  for (let i = 0; i <= maxRetries; i++) {
    attempts++;
    try {
      const result = await fn();
      // Attach retry metadata if result is an object
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        result.retry_attempts = attempts;
      }
      return result;
    } catch (err) {
      lastError = err;

      // Do NOT retry on 4xx errors — they won't succeed on retry
      const status = err?.status || err?.statusCode || err?.response?.status || err?.code;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        console.warn(`[Retry] 4xx error (${status}) — not retrying: ${err.message}`);
        err.retry_attempts = attempts;
        throw err;
      }

      if (i < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, i); // 1s, 2s, 4s
        console.info(`[Retry] Attempt ${i + 1} failed, retrying in ${delay}ms… (${err.message})`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // All retries exhausted
  console.error(`[Retry] All ${maxRetries + 1} attempts failed.`);
  if (lastError && typeof lastError === 'object') {
    lastError.retry_attempts = attempts;
  }
  throw lastError;
}

module.exports = { withRetry };
