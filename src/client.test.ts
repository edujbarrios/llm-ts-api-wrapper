import { LLMClient } from "./client";
import { LLMConfigError, LLMStreamError, LLMTimeoutError } from "./errors";

const createClient = (overrides: Record<string, unknown> = {}) =>
  new LLMClient({
    baseURL: "https://example.test/v1/",
    apiKey: "test",
    maxRetries: 0,
    timeoutMs: 1000,
    ...overrides,
  });

function streamResponse(parts: string[], type = "text/event-stream"): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    }),
    { headers: { "content-type": type } }
  );
}

afterEach(() => jest.restoreAllMocks());

test("rejects missing or non-array messages with a config error", async () => {
  const client = createClient();
  await expect(client.chat({ messages: null } as never)).rejects.toBeInstanceOf(LLMConfigError);
  await expect(client.chat({ messages: [] })).rejects.toBeInstanceOf(LLMConfigError);
  await expect(client.streamChat({ messages: null } as never).next()).rejects.toBeInstanceOf(LLMConfigError);
});

test("retries a transient API status but not a 400", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response('{"error":"temporary"}', { status: 503 }))
    .mockResolvedValueOnce(new Response('{"data":[],"object":"list"}'))
    .mockResolvedValueOnce(new Response('{"error":"invalid"}', { status: 400 }));
  const client = createClient({ maxRetries: 1, retryBackoffMs: 0 });
  expect((await client.listModels()).data).toEqual([]);
  await expect(client.listModels()).rejects.toMatchObject({ status: 400 });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test("streamChat parses fragmented CRLF and multiline SSE events", async () => {
  const mock = jest.spyOn(globalThis, "fetch").mockResolvedValue(streamResponse([
    ': keep alive\r\n\r\n',
    'event: message\r\ndata: {"id":"one",\r\n',
    'data: "choices":[]}\r\n\r\ndata: {"id":"two","choices":[]}\r\n',
    '\r\ndata: [DONE]\r\n\r\n',
  ]));
  const chunks = [];
  for await (const chunk of createClient().streamChat({ messages: [{ role: "user", content: "hi" }] })) {
    chunks.push(chunk.id);
  }
  expect(chunks).toEqual(["one", "two"]);
  expect(mock.mock.calls[0][0]).toBe("https://example.test/v1/chat/completions");
});

test("accepts NDJSON and a final non-newline-delimited event", async () => {
  jest.spyOn(globalThis, "fetch").mockResolvedValue(streamResponse(
    ['{"id":"a","choices":[]}\n{"id":"b","choices":[]}'],
    "application/x-ndjson"
  ));
  const ids = [];
  for await (const chunk of createClient().streamChat({ messages: [{ role: "user", content: "hi" }] })) {
    ids.push(chunk.id);
  }
  expect(ids).toEqual(["a", "b"]);
});

test("reports malformed events and provider stream errors", async () => {
  const mock = jest.spyOn(globalThis, "fetch");
  mock.mockResolvedValueOnce(streamResponse(["data: {not-json}\n\n"]));
  const client = createClient();
  await expect((async () => {
    for await (const _chunk of client.streamChat({ messages: [{ role: "user", content: "hi" }] })) {
      // intentionally consume
    }
  })()).rejects.toBeInstanceOf(LLMStreamError);
  mock.mockResolvedValueOnce(streamResponse(['event: error\ndata: {"error":{"message":"failed"}}\n\n']));
  await expect((async () => {
    for await (const _chunk of client.streamChat({ messages: [{ role: "user", content: "hi" }] })) {
      // intentionally consume
    }
  })()).rejects.toBeInstanceOf(LLMStreamError);
});

test("cancels reader when a stream consumer exits early", async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encoder.encode('data: {"id":"one","choices":[]}\n\n')); },
      cancel() { cancelled = true; },
    }),
    { headers: { "content-type": "text/event-stream" } }
  ));
  for await (const _chunk of createClient().streamChat({ messages: [{ role: "user", content: "hi" }] })) {
    break;
  }
  expect(cancelled).toBe(true);
});

test("aborts stalled requests and maps to LLMTimeoutError", async () => {
  jest.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  const client = createClient({ timeoutMs: 10 });
  await expect(client.listModels()).rejects.toBeInstanceOf(LLMTimeoutError);
});

test("rejects non-JSON success responses", async () => {
  jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("invalid json"));
  await expect(createClient().listModels()).rejects.toThrow("Invalid JSON");
});
