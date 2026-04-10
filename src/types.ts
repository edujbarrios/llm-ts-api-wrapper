/**
 * llm7-wrapper — Type definitions
 * Author: Eduardo J. Barrios <edujbarrios@outlook.com>
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface LLMClientConfig {
  /** Base URL of the OpenAI-compatible API, e.g. "https://llm7.io/v1" */
  baseURL: string;
  /** API key / bearer token */
  apiKey: string;
  /** Default model to use when none is specified in the request */
  defaultModel?: string;
  /** Request timeout in milliseconds (default: 30 000) */
  timeoutMs?: number;
  /** How many times to retry on transient errors (default: 2) */
  maxRetries?: number;
  /** Base back-off delay in milliseconds between retries (default: 1 000) */
  retryBackoffMs?: number;
  /** Additional default headers attached to every request */
  defaultHeaders?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
}

export type ContentPart = TextContentPart | ImageContentPart;

export interface ChatMessage {
  role: MessageRole;
  /** String for plain text; array for multi-modal content */
  content: string | ContentPart[];
  /** Optional name identifier */
  name?: string;
  /** For assistant tool-call messages */
  tool_calls?: ToolCall[];
  /** For tool-result messages */
  tool_call_id?: string;
}

// ---------------------------------------------------------------------------
// Tools / Function calling
// ---------------------------------------------------------------------------

export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

export interface ToolDefinition {
  type: "function";
  function: FunctionDefinition;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export type ToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

// ---------------------------------------------------------------------------
// Chat Completion Request / Response
// ---------------------------------------------------------------------------

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  /** Sampling temperature 0–2 */
  temperature?: number;
  /** Nucleus sampling 0–1 */
  top_p?: number;
  /** Maximum tokens to generate */
  max_tokens?: number;
  /** Number of completions to generate */
  n?: number;
  /** Stop sequences */
  stop?: string | string[];
  /** Presence penalty -2 to 2 */
  presence_penalty?: number;
  /** Frequency penalty -2 to 2 */
  frequency_penalty?: number;
  /** Streaming (managed internally; set via streamChat()) */
  stream?: boolean;
  /** Seed for deterministic sampling */
  seed?: number;
  /** Available tools */
  tools?: ToolDefinition[];
  /** Tool choice strategy */
  tool_choice?: ToolChoice;
  /** JSON mode */
  response_format?: { type: "text" | "json_object" };
  /** Arbitrary provider-specific extra fields */
  [key: string]: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason:
    | "stop"
    | "length"
    | "tool_calls"
    | "content_filter"
    | null;
  logprobs?: unknown;
}

export interface UsageStats {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: UsageStats;
  system_fingerprint?: string;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export interface ChatCompletionChunkDelta {
  role?: MessageRole;
  content?: string | null;
  tool_calls?: Partial<ToolCall>[];
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export interface ModelInfo {
  id: string;
  object: "model";
  created?: number;
  owned_by?: string;
}

export interface ModelsListResponse {
  object: "list";
  data: ModelInfo[];
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

export interface EmbeddingRequest {
  model?: string;
  input: string | string[];
  encoding_format?: "float" | "base64";
  dimensions?: number;
}

export interface EmbeddingObject {
  object: "embedding";
  index: number;
  embedding: number[];
}

export interface EmbeddingResponse {
  object: "list";
  data: EmbeddingObject[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

// ---------------------------------------------------------------------------
// Retry / internal helpers
// ---------------------------------------------------------------------------

export interface RetryOptions {
  maxRetries: number;
  backoffMs: number;
  /** HTTP status codes that are considered retryable */
  retryableStatuses?: number[];
}
