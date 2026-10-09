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

export type MessageRole = "system" | "developer" | "user" | "assistant" | "tool";

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
  content?: string | ContentPart[] | null;
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
  parameters?: Record<string, unknown>; // JSON Schema object
  strict?: boolean;
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
  /** Legacy generation cap; newer reasoning models use max_completion_tokens. */
  max_tokens?: number;
  /** Generated tokens, including reasoning tokens. */
  max_completion_tokens?: number;
  /** Optional reasoning effort for supporting models. */
  reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Whether the provider may run tool calls concurrently. */
  parallel_tool_calls?: boolean;
  /** Include usage in the final streaming chunk. */
  stream_options?: { include_usage?: boolean };
  /** Request persistence when supported. */
  store?: boolean;
  /** Arbitrary end-user identifier passed through to the provider. */
  user?: string;
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
  response_format?:
    | { type: "text" | "json_object" }
    | { type: "json_schema"; json_schema: {
        name: string;
        schema?: Record<string, unknown>;
        description?: string;
        strict?: boolean;
      } };
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
    | "function_call"
    | "content_filter"
    | null;
  logprobs?: unknown;
}

export interface UsageStats {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: Record<string, unknown>;
  completion_tokens_details?: Record<string, unknown>;
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
  /** Streaming tool call fragments use index to associate partial arguments. */
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
  refusal?: string | null;
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
  usage?: UsageStats | null;
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
  input: string | string[] | number[] | number[][];
  user?: string;
  encoding_format?: "float" | "base64";
  dimensions?: number;
}

export interface EmbeddingObject {
  object: "embedding";
  index: number;
  embedding: number[] | string;
}

export interface EmbeddingResponse {
  object: "list";
  data: EmbeddingObject[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

// ---------------------------------------------------------------------------
// Responses API — supported by OpenAI and select compatible providers
// ---------------------------------------------------------------------------

export interface ResponseInputText {
  type: "input_text";
  text: string;
}

export interface ResponseInputImage {
  type: "input_image";
  image_url: string;
  detail?: "auto" | "low" | "high";
}

export interface ResponseInputFile {
  type: "input_file";
  file_id?: string;
  file_data?: string;
  filename?: string;
}

export interface ResponseInputMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string | Array<ResponseInputText | ResponseInputImage | ResponseInputFile>;
}

export interface ResponseFunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export type ResponseInputItem = ResponseInputMessage | ResponseFunctionCallOutput;

export interface ResponseFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface CreateResponseRequest {
  model?: string;
  input: string | ResponseInputItem[];
  instructions?: string;
  previous_response_id?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  reasoning?: { effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"; summary?: string };
  text?: { format?: 
    | { type: "text" | "json_object" }
    | { type: "json_schema"; name: string; schema: Record<string, unknown>; strict?: boolean; description?: string }
  };
  tools?: Array<ResponseFunctionTool | Record<string, unknown>>;
  tool_choice?: "auto" | "none" | "required" | { type: string; name?: string };
  store?: boolean;
  stream?: boolean;
  [key: string]: unknown;
}

export interface ResponseOutputItem {
  id?: string;
  type: string;
  role?: string;
  status?: string;
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  name?: string;
  call_id?: string;
  arguments?: string;
  [key: string]: unknown;
}

export interface CreateResponseResult {
  id: string;
  object: "response";
  model: string;
  status: "completed" | "failed" | "in_progress" | "cancelled" | "queued" | "incomplete";
  output: ResponseOutputItem[];
  usage?: Record<string, unknown> | null;
  error?: unknown;
  [key: string]: unknown;
}

/** Wire SSE payloads from /responses, e.g. response.output_text.delta. */
export interface ResponseStreamEvent {
  type: string;
  sequence_number?: number;
  delta?: string;
  response?: CreateResponseResult;
  [key: string]: unknown;
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
