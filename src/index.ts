/**
 * llm7-wrapper — Public API surface
 * Author: Eduardo J. Barrios <edujbarrios@outlook.com>
 *
 * Usage:
 *   import { LLMClient } from "llm7-wrapper";
 *   // or
 *   import { LLMClient, LLMRateLimitError, type ChatMessage } from "llm7-wrapper";
 */

// Client
export { LLMClient } from "./client";

// All types
export type {
  LLMClientConfig,
  MessageRole,
  TextContentPart,
  ImageContentPart,
  ContentPart,
  ChatMessage,
  FunctionDefinition,
  ToolDefinition,
  ToolCall,
  ToolChoice,
  ChatCompletionRequest,
  ChatCompletionChoice,
  UsageStats,
  ChatCompletionResponse,
  ChatCompletionChunkDelta,
  ChatCompletionChunkChoice,
  ChatCompletionChunk,
  ModelInfo,
  ModelsListResponse,
  EmbeddingRequest,
  EmbeddingObject,
  EmbeddingResponse,
  RetryOptions,
} from "./types";

// Error classes
export {
  LLMError,
  LLMAPIError,
  LLMAuthenticationError,
  LLMPermissionError,
  LLMNotFoundError,
  LLMRateLimitError,
  LLMServerError,
  LLMTimeoutError,
  LLMNetworkError,
  LLMStreamError,
  LLMConfigError,
  createAPIError,
} from "./errors";
