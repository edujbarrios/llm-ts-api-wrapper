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

  /**
   * Keep the abort timer active through body consumption, not only until fetch()
   * resolves. Each retry receives a fresh controller and deadline.
   */
  private async requestJSON<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = this.config.baseURL + path;
    return withRetry(async () => {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.config.timeoutMs);

      try {
        const res = await fetch(url, {
          method,
          headers: buildHeaders(this.config),
          ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
        });

        if (!res.ok) {
          const parsed = await parseBody(res);
          throw createAPIError(res.status, parsed, res.headers.get("x-request-id") ?? undefined);
        }

        const responseText = await res.text();
        try {
          return JSON.parse(responseText) as T;
        } catch {
          throw new LLMError("Invalid JSON response from " + url);
        }
      } catch (err: unknown) {
        if (timedOut || (err instanceof Error && err.name === "AbortError")) {
          throw new LLMTimeoutError(this.config.timeoutMs);
        }
        if (err instanceof LLMError) throw err;
        throw new LLMNetworkError("Network error while fetching " + url + ": " + String(err), err);
      } finally {
        clearTimeout(timer);
      }
    }, this.retryOptions());
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
    return this.requestJSON<T>("POST", path, body);
  }

  private async get<T>(path: string): Promise<T> {
    return this.requestJSON<T>("GET", path);
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
    if (!request || !Array.isArray(request.messages) || request.messages.length === 0) {
      throw new LLMConfigError("messages array is required and cannot be empty.");
    }

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
    if (!res.choices || res.choices.length === 0) {
      throw new LLMError(
        "Unexpected: response contains no choices."
      );
    }
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
  /**
   * Parse complete SSE frames (including multiline data and CRLF) or NDJSON.
   * Never retry after starting to consume a stream, to avoid duplicate output.
   */
  private async *streamEvents<T>(path: string, payload: unknown): AsyncGenerator<T, void, unknown> {
    const url = this.config.baseURL + path;
    const res = await withRetry(async () => {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.config.timeoutMs);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { ...buildHeaders(this.config), Accept: "text/event-stream" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!response.ok) {
          const parsed = await parseBody(response);
          throw createAPIError(response.status, parsed, response.headers.get("x-request-id") ?? undefined);
        }
        return response;
      } catch (err: unknown) {
        if (timedOut || (err instanceof Error && err.name === "AbortError")) {
          throw new LLMTimeoutError(this.config.timeoutMs);
        }
        if (err instanceof LLMError) throw err;
        throw new LLMNetworkError("Network error during streaming: " + String(err), err);
      } finally {
        clearTimeout(timer);
      }
    }, this.retryOptions());

    if (!res.body) throw new LLMStreamError("Response body is null — streaming not supported.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const ndjson = /ndjson/i.test(res.headers.get("content-type") ?? "");
    let buffer = "";
    let dataLines: string[] = [];
    let eventType = "";

    const parse = (raw: string): T | "DONE" | undefined => {
      if (!raw.trim()) return undefined;
      if (raw.trim() === "[DONE]") return "DONE";
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new LLMStreamError("Failed to parse stream event: " + raw);
      }
      if (eventType === "error" || (value !== null && typeof value === "object" && "error" in value)) {
        throw new LLMStreamError("Provider stream error: " + JSON.stringify(value));
      }
      return value as T;
    };

    const acceptLine = (line: string): T | "DONE" | undefined => {
      if (ndjson) return parse(line.trim());
      if (line === "") {
        const raw = dataLines.join("\n");
        dataLines = [];
        const result = parse(raw);
        eventType = "";
        return result;
      }
      if (line.startsWith(":")) return undefined;
      if (line.startsWith("data:")) {
        const value = line.slice(5);
        dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
      } else if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      }
      return undefined;
    };

    const readWithIdleTimeout = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new LLMTimeoutError(this.config.timeoutMs)), this.config.timeoutMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };

    try {
      while (true) {
        const { done, value } = await readWithIdleTimeout();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
          const result = acceptLine(rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine);
          if (result === "DONE") return;
          if (result !== undefined) yield result;
        }
      }
      buffer += decoder.decode();
      if (buffer) {
        const result = acceptLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
        if (result === "DONE") return;
        if (result !== undefined) yield result;
      }
      if (!ndjson && dataLines.length) {
        const result = parse(dataLines.join("\n"));
        if (result !== undefined && result !== "DONE") yield result;
      }
    } catch (err: unknown) {
      if (err instanceof LLMError) throw err;
      throw new LLMStreamError("Error reading stream: " + String(err));
    } finally {
      await reader.cancel().catch(() => {});
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  }

  async *streamChat(
    request: Omit<ChatCompletionRequest, "stream">
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    if (!request || !Array.isArray(request.messages) || request.messages.length === 0) {
      throw new LLMConfigError("messages array is required and cannot be empty.");
    }
    const model = request.model ?? this.config.defaultModel ?? "gpt-3.5-turbo";
    const payload = { ...request, model, stream: true };
    yield* this.streamEvents<ChatCompletionChunk>("/chat/completions", payload);
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
