# llm-ts-api-wrapper

> **A TypeScript wrapper for any OpenAI-compatible API — llm7.io, OpenAI, Azure OpenAI, Groq, Together AI, and more.**

Built by **Eduardo J. Barrios** · [edujbarrios@outlook.com](mailto:edujbarrios@outlook.com)

---

## Intent & philosophy

This package was originally built for **private use** — the goal is to have full, direct control over how LLM API calls are made, retried, streamed, and error-handled, without depending on a third-party SDK whose internals you can't audit or change.

It has been **open-sourced as-is** in case it is useful to someone else facing the same problem.

> **npm publication is not discarded.** If this project gains traction or interest from the community, publishing it as an installable package on the npm registry is on the table.

---

## Features

| Feature | Details |
|---|---|
| **Chat completions** | Standard & streaming (SSE) |
| **Embeddings** | `/embeddings` endpoint |
| **Model listing** | `/models` endpoint |
| **Tool / function calling** | Full type support |
| **Auto-retry** | Exponential back-off + jitter on 429/5xx/network errors |
| **Timeout** | Configurable per-client, uses `AbortController` |
| **Typed errors** | `LLMAuthenticationError`, `LLMRateLimitError`, … |
| **Zero runtime deps** | Uses the built-in `fetch` (Node ≥ 18) |

---

## Clone & build

```bash
git clone https://github.com/edujbarrios/llm-ts-api-wrapper.git
cd llm-ts-api-wrapper
npm install
npm run build
```

Then import directly from the compiled output in your project:

```typescript
import { LLMClient } from "./path/to/llm-ts-api-wrapper/dist";
```

> Since this package is designed for **private/local use**, you copy or submodule this repo into your project instead of installing from npm.

---

## Quick start

### 1. Create a client

```typescript
import { LLMClient } from "./dist"; // local build

const client = new LLMClient({
  baseURL: "https://api.llm7.io/v1",  // any OpenAI-compatible base URL
  apiKey: process.env.LLM_API_KEY!,  // or "llm7-free" for the free tier
  defaultModel: "default",
  maxRetries: 3,
  retryBackoffMs: 1000,
  timeoutMs: 30_000,
});
```

### 2. Send a chat message

```typescript
const response = await client.chat({
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user",   content: "What is TypeScript?" },
  ],
});

console.log(response.choices[0].message.content);
// → "TypeScript is a strongly typed programming language…"
```

### 3. Convenience: get text directly

```typescript
const text = await client.chatText({
  messages: [{ role: "user", content: "Tell me a joke." }],
});
console.log(text);
```

### 4. Streaming

```typescript
for await (const chunk of client.streamChat({
  messages: [{ role: "user", content: "Count to 5." }],
})) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

Or collect the full stream:

```typescript
const full = await client.streamChatText({
  messages: [{ role: "user", content: "Count to 5." }],
});
```

### 5. List models

```typescript
const { data: models } = await client.listModels();
models.forEach(m => console.log(m.id));
```

### 6. Generate embeddings

```typescript
const result = await client.embed({
  input: "Hello, world!",
  model: "text-embedding-ada-002",
});
const vector = result.data[0].embedding;
```

### 7. Function / tool calling

```typescript
const res = await client.chat({
  messages: [{ role: "user", content: "What's the weather in Madrid?" }],
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get the current weather for a city.",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
          required: ["city"],
        },
      },
    },
  ],
  tool_choice: "auto",
});

const toolCall = res.choices[0].message.tool_calls?.[0];
if (toolCall) {
  const args = JSON.parse(toolCall.function.arguments);
  console.log("Calling tool:", toolCall.function.name, args);
}
```

---

## Error handling

```typescript
import {
  LLMClient,
  LLMRateLimitError,
  LLMAuthenticationError,
  LLMTimeoutError,
  LLMNetworkError,
} from "./dist";

try {
  const text = await client.chatText({ messages: [...] });
} catch (err) {
  if (err instanceof LLMRateLimitError) {
    console.error("Rate limit hit, slow down.");
  } else if (err instanceof LLMAuthenticationError) {
    console.error("Bad API key.");
  } else if (err instanceof LLMTimeoutError) {
    console.error("Request timed out.");
  } else if (err instanceof LLMNetworkError) {
    console.error("Network problem:", err.cause);
  } else {
    throw err; // re-throw unknown errors
  }
}
```

---

## Configuration reference

| Option | Type | Default | Description |
|---|---|---|---|
| `baseURL` | `string` | **required** | Base URL of the OpenAI-compatible API |
| `apiKey` | `string` | **required** | Bearer token / API key |
| `defaultModel` | `string` | `undefined` | Fallback model when none is given per-request |
| `timeoutMs` | `number` | `30000` | Request timeout in milliseconds |
| `maxRetries` | `number` | `2` | Retries on 429/5xx/network errors |
| `retryBackoffMs` | `number` | `1000` | Base delay for exponential back-off |
| `defaultHeaders` | `Record<string,string>` | `{}` | Extra headers added to every request |

---

## Supported endpoints

| Method | Endpoint |
|---|---|
| `chat()` / `chatText()` | `POST /chat/completions` |
| `streamChat()` / `streamChatText()` | `POST /chat/completions` (SSE) |
| `embed()` | `POST /embeddings` |
| `listModels()` | `GET /models` |

---

## Examples

Ready-to-run examples live in [`src/examples/`](src/examples/).

| Script | What it does |
|---|---|
| `npm run example:capital` | Asks llm7.io "What is the capital of Spain?" (free tier, no key needed) |

```bash
npm run build
npm run example:capital
# → Answer: The capital of Spain is Madrid.
```

---

## Build

```bash
npm run build    # compile to dist/
npm run dev      # watch mode
npm run clean    # remove dist/
```

---

## License

MIT © 2026 Eduardo J. Barrios — see [LICENSE](LICENSE)
