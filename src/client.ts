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

    this.config = {
      baseURL: config.baseURL.replace(/\/$/, ""), // strip trailing slash
      apiKey: config.apiKey,
      defaultModel: config.defaultModel,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryBackoffMs: config.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS,
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
      throw new LLMStreamError(
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

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs
    );

    let res: Response;
    try {
      res = await fetch(url, {
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

    if (!res.ok) {
      clearTimeout(timer);
      const parsed = await parseBody(res);
      const requestId = res.headers.get("x-request-id") ?? undefined;
      throw createAPIError(res.status, parsed, requestId);
    }

    if (!res.body) {
      clearTimeout(timer);
      throw new LLMStreamError("Response body is null — streaming not supported.");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
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

            try {
              const chunk = JSON.parse(data) as ChatCompletionChunk;
              yield chunk;
            } catch {
              throw new LLMStreamError(`Failed to parse stream chunk: ${data}`);
            }
          }
        }
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
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
