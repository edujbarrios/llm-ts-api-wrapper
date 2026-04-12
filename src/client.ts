/**
 * llm7-wrapper — Core LLM client
 * Author: Eduardo J. Barrios <edujbarrios@outlook.com>
 *
 * Drop-in client for any OpenAI-compatible REST API.
 * Tested with llm7.io, OpenAI, Azure OpenAI, Groq, Together AI, and more.
 */

import {
  LLMClientConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ModelsListResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  RetryOptions,
} from "./types";

import {
  LLMError,
  LLMConfigError,
  LLMNetworkError,
  LLMTimeoutError,
  LLMStreamError,
  createAPIError,
} from "./errors";

import { withRetry } from "./utils/retry";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BACKOFF_MS = 1_000;

function buildHeaders(config: LLMClientConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
    ...config.defaultHeaders,
  };
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class LLMClient {
  private readonly config: Required<
    Omit<LLMClientConfig, "defaultHeaders" | "defaultModel">
  > & {
    defaultHeaders: Record<string, string>;
    defaultModel: string | undefined;
  };

  constructor(config: LLMClientConfig) {
    if (!config.baseURL) {
      throw new LLMConfigError("baseURL is required.");
    }
    if (!config.apiKey) {
      throw new LLMConfigError("apiKey is required.");
    }

    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    const retryBackoffMs = config.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;

    if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) {
      throw new LLMConfigError("timeoutMs must be a positive finite number.");
    }
    if (maxRetries < 0 || !Number.isInteger(maxRetries)) {
      throw new LLMConfigError("maxRetries must be a non-negative integer.");
    }
    if (retryBackoffMs < 0 || !Number.isFinite(retryBackoffMs)) {
      throw new LLMConfigError("retryBackoffMs must be a non-negative finite number.");
    }

    this.config = {
      baseURL: config.baseURL.replace(/\/$/, ""), // strip trailing slash
      apiKey: config.apiKey,
      defaultModel: config.defaultModel,
      timeoutMs,
      maxRetries,
      retryBackoffMs,
      defaultHeaders: config.defaultHeaders ?? {},
    };
  }

  // -------------------------------------------------------------------------
  // Low-level fetch with timeout + error mapping
  // -------------------------------------------------------------------------

  private async fetchWithTimeout(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs
    );

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      return res;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.name === "AbortError" || err.message.includes("abort"))
      ) {
        throw new LLMTimeoutError(this.config.timeoutMs);
      }
      throw new LLMNetworkError(
        `Network error while fetching ${url}: ${String(err)}`,
        err
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private retryOptions(): RetryOptions {
    return {
      maxRetries: this.config.maxRetries,
      backoffMs: this.config.retryBackoffMs,
    };
  }

  // -------------------------------------------------------------------------
  // POST helper (non-streaming)
  // -------------------------------------------------------------------------

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.config.baseURL}${path}`;
    const headers = buildHeaders(this.config);

    return withRetry(async () => {
      const res = await this.fetchWithTimeout(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const parsed = await parseBody(res);
        const requestId = res.headers.get("x-request-id") ?? undefined;
        throw createAPIError(res.status, parsed, requestId);
      }

      return (await res.json()) as T;
    }, this.retryOptions());
  }

  // -------------------------------------------------------------------------
  // GET helper
  // -------------------------------------------------------------------------

  private async get<T>(path: string): Promise<T> {
    const url = `${this.config.baseURL}${path}`;
    const headers = buildHeaders(this.config);

    return withRetry(async () => {
      const res = await this.fetchWithTimeout(url, {
        method: "GET",
        headers,
      });

      if (!res.ok) {
        const parsed = await parseBody(res);
        const requestId = res.headers.get("x-request-id") ?? undefined;
        throw createAPIError(res.status, parsed, requestId);
      }

      return (await res.json()) as T;
    }, this.retryOptions());
  }

  // -------------------------------------------------------------------------
  // Chat Completions — standard (non-streaming)
  // -------------------------------------------------------------------------

  /**
   * Send a chat completion request and return the full response.
   *
   * @example
   * const reply = await client.chat({
   *   messages: [{ role: "user", content: "Hello!" }],
   * });
   * console.log(reply.choices[0].message.content);
   */
  async chat(
    request: Omit<ChatCompletionRequest, "stream">
  ): Promise<ChatCompletionResponse> {
    const model = ((request.model as string | undefined) ?? this.config.defaultModel ?? "gpt-3.5-turbo");
    const payload = { ...request, model, stream: false } as ChatCompletionRequest;

    return this.post<ChatCompletionResponse>("/chat/completions", payload);
  }

  /**
   * Convenience method — returns the text content of the first choice.
   */
  async chatText(
    request: Omit<ChatCompletionRequest, "stream">
  ): Promise<string> {
    const res = await this.chat(request);
    const content = res.choices[0]?.message?.content;
    if (typeof content !== "string") {
      throw new LLMError(
        "Unexpected: first choice has no string content."
      );
    }
    return content;
  }

  // -------------------------------------------------------------------------
  // Chat Completions — streaming (Server-Sent Events / NDJSON)
  // -------------------------------------------------------------------------

  /**
   * Send a streaming chat completion request.
   * Returns an async generator that yields `ChatCompletionChunk` objects.
   *
   * @example
   * for await (const chunk of client.streamChat({ messages: [...] })) {
   *   process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
   * }
   */
  async *streamChat(
    request: Omit<ChatCompletionRequest, "stream">
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const model = ((request.model as string | undefined) ?? this.config.defaultModel ?? "gpt-3.5-turbo");
    const payload = { ...request, model, stream: true } as ChatCompletionRequest;

    const url = `${this.config.baseURL}/chat/completions`;
    const headers = buildHeaders(this.config);

    // Retry the initial connection (not the stream itself)
    const res = await withRetry(async () => {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs
      );

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (err: unknown) {
        clearTimeout(timer);
        if (
          err instanceof Error &&
          (err.name === "AbortError" || err.message.includes("abort"))
        ) {
          throw new LLMTimeoutError(this.config.timeoutMs);
        }
        throw new LLMNetworkError(
          `Network error during streaming: ${String(err)}`,
          err
        );
      }

      clearTimeout(timer);

      if (!response.ok) {
        const parsed = await parseBody(response);
        const requestId = response.headers.get("x-request-id") ?? undefined;
        throw createAPIError(response.status, parsed, requestId);
      }

      return response;
    }, this.retryOptions());

    if (!res.body) {
      throw new LLMStreamError("Response body is null — streaming not supported.");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    const timeoutMs = this.config.timeoutMs;

    // Race each read() call against an idle timeout so that long-running
    // streams are not prematurely aborted while data is still flowing,
    // but stalls between chunks are still detected.
    const readWithIdleTimeout = (): Promise<{ done: boolean; value?: Uint8Array }> => {
      return new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new LLMTimeoutError(timeoutMs));
          reader.cancel().catch(() => {});
        }, timeoutMs);

        reader.read().then(
          (result) => { clearTimeout(timer); resolve(result); },
          (err)    => { clearTimeout(timer); reject(err); }
        );
      });
    };

    try {
      while (true) {
        const { done, value } = await readWithIdleTimeout();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last (potentially incomplete) line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === ":") continue; // SSE keep-alive

          if (trimmed.startsWith("data:")) {
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") return;
            if (!data) continue; // skip empty data lines

            try {
              const chunk = JSON.parse(data) as ChatCompletionChunk;
              yield chunk;
            } catch {
              throw new LLMStreamError(`Failed to parse stream chunk: ${data}`);
            }
          }
        }
      }

      // Flush any remaining data in the buffer after the stream ends.
      // This handles servers that close without a trailing newline.
      const remaining = buffer.trim();
      if (remaining && remaining.startsWith("data:")) {
        const data = remaining.slice(5).trim();
        if (data && data !== "[DONE]") {
          try {
            const chunk = JSON.parse(data) as ChatCompletionChunk;
            yield chunk;
          } catch {
            throw new LLMStreamError(`Failed to parse stream chunk: ${data}`);
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* already cancelled */ }
    }
  }

  /**
   * Convenience method — collect all stream chunks and return the full text.
   */
  async streamChatText(
    request: Omit<ChatCompletionRequest, "stream">
  ): Promise<string> {
    let text = "";
    for await (const chunk of this.streamChat(request)) {
      text += chunk.choices[0]?.delta?.content ?? "";
    }
    return text;
  }

  // -------------------------------------------------------------------------
  // Models
  // -------------------------------------------------------------------------

  /**
   * List all models available on the configured endpoint.
   */
  async listModels(): Promise<ModelsListResponse> {
    return this.get<ModelsListResponse>("/models");
  }

  // -------------------------------------------------------------------------
  // Embeddings
  // -------------------------------------------------------------------------

  /**
   * Generate embeddings for the given input(s).
   *
   * @example
   * const result = await client.embed({
   *   input: "Hello, world!",
   *   model: "text-embedding-ada-002",
   * });
   * const vector = result.data[0].embedding;
   */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const payload: EmbeddingRequest = {
      ...request,
      model: request.model ?? this.config.defaultModel ?? "text-embedding-ada-002",
    };
    return this.post<EmbeddingResponse>("/embeddings", payload);
  }
}
