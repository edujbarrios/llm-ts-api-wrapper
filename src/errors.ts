/**
 * llm7-wrapper — Custom error classes
 * Author: Eduardo J. Barrios <edujbarrios@outlook.com>
 */

// ---------------------------------------------------------------------------
// Base error
// ---------------------------------------------------------------------------

export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMError";
    // Restore prototype chain (important for instanceof checks in TS)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// API / HTTP errors
// ---------------------------------------------------------------------------

export class LLMAPIError extends LLMError {
  /** HTTP status code returned by the server */
  public readonly status: number;
  /** Raw response body from the server */
  public readonly body: unknown;
  /** Request ID header from the server, if present */
  public readonly requestId?: string;

  constructor(
    message: string,
    status: number,
    body: unknown,
    requestId?: string
  ) {
    super(message);
    this.name = "LLMAPIError";
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

export class LLMAuthenticationError extends LLMAPIError {
  constructor(body: unknown, requestId?: string) {
    super("Authentication failed — check your API key.", 401, body, requestId);
    this.name = "LLMAuthenticationError";
  }
}

export class LLMPermissionError extends LLMAPIError {
  constructor(body: unknown, requestId?: string) {
    super("Permission denied — your account may not have access to this resource.", 403, body, requestId);
    this.name = "LLMPermissionError";
  }
}

export class LLMNotFoundError extends LLMAPIError {
  constructor(body: unknown, requestId?: string) {
    super("Resource not found — check the model name or endpoint.", 404, body, requestId);
    this.name = "LLMNotFoundError";
  }
}

export class LLMRateLimitError extends LLMAPIError {
  constructor(body: unknown, requestId?: string) {
    super("Rate limit exceeded — slow down or upgrade your plan.", 429, body, requestId);
    this.name = "LLMRateLimitError";
  }
}

export class LLMServerError extends LLMAPIError {
  constructor(status: number, body: unknown, requestId?: string) {
    super(`Server error (${status}) — the API is experiencing issues.`, status, body, requestId);
    this.name = "LLMServerError";
  }
}

// ---------------------------------------------------------------------------
// Client-side errors
// ---------------------------------------------------------------------------

export class LLMTimeoutError extends LLMError {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms.`);
    this.name = "LLMTimeoutError";
  }
}

export class LLMNetworkError extends LLMError {
  public readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "LLMNetworkError";
    this.cause = cause;
  }
}

export class LLMStreamError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMStreamError";
  }
}

export class LLMConfigError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMConfigError";
  }
}

// ---------------------------------------------------------------------------
// Factory — maps HTTP status → specific error class
// ---------------------------------------------------------------------------

export function createAPIError(
  status: number,
  body: unknown,
  requestId?: string
): LLMAPIError {
  switch (status) {
    case 401:
      return new LLMAuthenticationError(body, requestId);
    case 403:
      return new LLMPermissionError(body, requestId);
    case 404:
      return new LLMNotFoundError(body, requestId);
    case 429:
      return new LLMRateLimitError(body, requestId);
    default:
      if (status >= 500) {
        return new LLMServerError(status, body, requestId);
      }
      return new LLMAPIError(
        `Unexpected API error (HTTP ${status})`,
        status,
        body,
        requestId
      );
  }
}
