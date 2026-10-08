import { LLMClient } from "./client";
import { LLMConfigError } from "./errors";
import type { ChatCompletionRequest, CreateResponseRequest } from "./types";

const client = () => new LLMClient({
  baseURL: "https://example.test/v1",
  apiKey: "test",
  defaultModel: "some-model",
  maxRetries: 0,
});

afterEach(() => jest.restoreAllMocks());

test("uses the configured model and preserves modern chat fields", async () => {
  const spy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response('{"choices":[{"message":{"role":"assistant","content":"ok"}}]}')
  );
  const request: ChatCompletionRequest = {
    messages: [{ role: "developer", content: "Help." }, { role: "user", content: "Hello" }],
    max_completion_tokens: 100,
    response_format: {
      type: "json_schema",
      json_schema: { name: "Result", schema: { type: "object", properties: {} }, strict: true },
    },
    tools: [{ type: "function", function: { name: "ping", strict: true } }],
  };
  await client().chat(request);
  const sent = JSON.parse(spy.mock.calls[0][1]?.body as string);
  expect(sent).toMatchObject({
    model: "some-model",
    stream: false,
    max_completion_tokens: 100,
    response_format: { type: "json_schema" },
    messages: [{ role: "developer" }, { role: "user" }],
  });
});

test("rejects a missing model instead of inserting a deprecated implicit default", async () => {
  const c = new LLMClient({ baseURL: "https://example.test/v1", apiKey: "test", maxRetries: 0 });
  await expect(c.chat({ messages: [{ role: "user", content: "Hello" }] })).rejects.toBeInstanceOf(LLMConfigError);
  await expect(c.embed({ input: "Hello" })).rejects.toBeInstanceOf(LLMConfigError);
});

test("creates a response and extracts all assistant text parts from the wire response", async () => {
  const spy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    id: "resp_1",
    object: "response",
    model: "some-model",
    status: "completed",
    output: [
      { type: "reasoning", content: [] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello " }, { type: "output_text", text: "world" }] },
    ],
  })));
  const request: CreateResponseRequest = { input: "Hi", text: { format: { type: "text" } } };
  expect(await client().responseText(request)).toBe("Hello world");
  expect(spy.mock.calls[0][0]).toBe("https://example.test/v1/responses");
  expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toMatchObject({
    model: "some-model", stream: false, input: "Hi",
  });
});

test("streams raw Responses events and aggregates output_text delta only", async () => {
  const data = [
    'event: response.created\r\ndata: {"type":"response.created"}\r\n\r\n',
    'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"Hello"}\r\n\r\n',
    'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":" world"}\r\n\r\n',
    'data: [DONE]\r\n\r\n',
  ];
  jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      data.forEach(part => controller.enqueue(encoder.encode(part)));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } }));
  expect(await client().streamResponseText({ input: "Hi" })).toBe("Hello world");
});

test("retrieves exact model IDs and Responses resources with encoded path segments", async () => {
  const spy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"id":"resource"}'));
  await client().retrieveModel("org/model");
  await client().retrieveResponse("resp+id");
  await client().deleteResponse("resp+id");
  expect(spy.mock.calls.map(args => [args[0], args[1]?.method])).toEqual([
    ["https://example.test/v1/models/org%2Fmodel", "GET"],
    ["https://example.test/v1/responses/resp%2Bid", "GET"],
    ["https://example.test/v1/responses/resp%2Bid", "DELETE"],
  ]);
});

test("supports token arrays and base64 embeddings without lying about return types", async () => {
  const spy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    '{"data":[{"object":"embedding","index":0,"embedding":"AAAA"}],"model":"some-model","object":"list","usage":{"prompt_tokens":2,"total_tokens":2}}'
  ));
  const result = await client().embed({ input: [[123, 234]], encoding_format: "base64" });
  expect(result.data[0].embedding).toBe("AAAA");
  expect(JSON.parse(spy.mock.calls[0][1]?.body as string).input).toEqual([[123, 234]]);
});
