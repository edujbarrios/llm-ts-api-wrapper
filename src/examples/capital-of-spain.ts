/**
 * Example: Ask LLM "What is the capital of Spain?" using llm7.io
 * --------------------------------------------------------------
 * Run after building the project:
 *   npm run build
 *   node dist/examples/capital-of-spain.js
 *
 * API key: llm7.io free tier — get yours at https://token.llm7.io/
 * Leave as "llm7-free" to use the unauthenticated free tier.
 */

import { LLMClient, LLMError } from "../index";

const client = new LLMClient({
  baseURL: "https://api.llm7.io/v1",
  apiKey: "llm7-free",          // free / unauthenticated tier
  defaultModel: "default",       // llm7.io balanced-routing model
  maxRetries: 3,
  retryBackoffMs: 1500,
  timeoutMs: 30_000,
});

async function main(): Promise<void> {
  console.log("Asking llm7.io: 'What is the capital of Spain?'\n");

  const answer = await client.chatText({
    messages: [
      {
        role: "system",
        content: "You are a concise geography assistant. Answer in one sentence.",
      },
      {
        role: "user",
        content: "What is the capital of Spain?",
      },
    ],
    temperature: 0,
  });

  console.log("Answer:", answer);
}

main().catch((err: unknown) => {
  if (err instanceof LLMError) {
    console.error(`[${err.name}] ${err.message}`);
  } else {
    console.error("Unexpected error:", err);
  }
  process.exit(1);
});
