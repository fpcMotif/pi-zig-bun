import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnthropicProviderClient } from "../src/providers/anthropic";
import { GoogleProviderClient } from "../src/providers/google";
import { OpenAIProviderClient } from "../src/providers/openai";
import type { ProviderClient, ProviderErrorCode, ProviderMessage, ProviderStreamEvent } from "../src/providers/types";

const FIXTURES = resolve(process.cwd(), "test/fixtures/providers");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockSseFetch(sseBody: string): void {
  globalThis.fetch = ((async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseBody));
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as unknown) as typeof fetch;
}

const baseRequest = {
  model: "fixture-model",
  messages: [{ role: "user", content: "Say hello" }] satisfies ProviderMessage[],
};

async function collectEvents(client: ProviderClient): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of client.stream(baseRequest)) {
    events.push(event);
  }
  return events;
}

describe("provider streaming contracts", () => {
  test.each([
    ["openai", new OpenAIProviderClient({ apiKey: "x", model: "fixture-model", baseUrl: "https://mock.local" }), "openai-success.sse"],
    ["anthropic", new AnthropicProviderClient({ apiKey: "x", model: "fixture-model", baseUrl: "https://mock.local" }), "anthropic-success.sse"],
    ["google", new GoogleProviderClient({ apiKey: "x", model: "fixture-model", baseUrl: "https://mock.local" }), "google-success.sse"],
  ])("%s emits delta and done events", async (_, client, fixture) => {
    mockSseFetch(readFileSync(resolve(FIXTURES, fixture), "utf8"));

    const events = await collectEvents(client);
    const deltas = events.filter((event): event is Extract<ProviderStreamEvent, { type: "delta" }> => event.type === "delta");

    expect(deltas.map((event) => event.token).join("")).toBe("Hello world");
    expect(events.at(-1)).toEqual({ type: "done" });

    const result = await client.send(baseRequest);
    expect(result.text).toBe("Hello world");
  });

  test.each([
    ["openai", new OpenAIProviderClient({ apiKey: "x", model: "fixture-model", baseUrl: "https://mock.local" }), "openai-error.sse", "auth_error"],
    ["anthropic", new AnthropicProviderClient({ apiKey: "x", model: "fixture-model", baseUrl: "https://mock.local" }), "anthropic-error.sse", "rate_limit"],
    ["google", new GoogleProviderClient({ apiKey: "x", model: "fixture-model", baseUrl: "https://mock.local" }), "google-error.sse", "auth_error"],
  ])("%s emits typed errors", async (_, client, fixture, expectedCode) => {
    mockSseFetch(readFileSync(resolve(FIXTURES, fixture), "utf8"));

    const events = await collectEvents(client);
    const error = events.find((event): event is Extract<ProviderStreamEvent, { type: "error" }> => event.type === "error");

    expect(error).toBeDefined();
    expect(error?.error.code).toBe(expectedCode as ProviderErrorCode);
  });

  test("provider swap keeps call-site logic stable", async () => {
    const clients: ProviderClient[] = [
      new OpenAIProviderClient({ apiKey: "x", model: "fixture-model", baseUrl: "https://mock.local" }),
      new AnthropicProviderClient({ apiKey: "x", model: "fixture-model", baseUrl: "https://mock.local" }),
      new GoogleProviderClient({ apiKey: "x", model: "fixture-model", baseUrl: "https://mock.local" }),
    ];

    const fixtures = ["openai-success.sse", "anthropic-success.sse", "google-success.sse"];
    const outputs: string[] = [];

    for (const [idx, client] of clients.entries()) {
      mockSseFetch(readFileSync(resolve(FIXTURES, fixtures[idx]!), "utf8"));
      const result = await client.send(baseRequest);
      outputs.push(result.text);
    }

    expect(outputs).toEqual(["Hello world", "Hello world", "Hello world"]);
  });
});
