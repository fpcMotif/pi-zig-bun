import * as fs from "node:fs";

const content = fs.readFileSync("tests/agent-providers.test.ts", "utf-8");

const importSearch = 'import { describe, expect, test } from "bun:test";\nimport { OpenAIAdapter, AnthropicAdapter, GoogleGenAIAdapter } from "../src/agent/providers";\nimport { createAgentFromEnv } from "../src/agent";\nimport type { AgentRequest } from "../src/agent/types";\n\n/**\n * Each adapter\'s `buildRequest` and `parseChunk` are `protected`, so we expose';

const replacement = `import { describe, expect, test, spyOn, afterEach } from "bun:test";
import { BaseSseAgent, OpenAIAdapter, AnthropicAdapter, GoogleGenAIAdapter } from "../src/agent/providers";
import { createAgentFromEnv } from "../src/agent";
import type { AgentRequest, AgentToolCall } from "../src/agent/types";

// ---------------------------------------------------------------------------
// BaseSseAgent
// ---------------------------------------------------------------------------
class TestBaseAgent extends BaseSseAgent {
  public chunksToReturn: Array<{ token?: string; toolCall?: AgentToolCall; done?: boolean }> = [];
  private parseCount = 0;

  protected buildRequest(input: AgentRequest, stream: boolean): { url: string; init: RequestInit } {
    return {
      url: "https://test.local/stream",
      init: { method: "POST", body: JSON.stringify({ stream }) },
    };
  }

  protected parseChunk(payload: unknown) {
    if (this.parseCount < this.chunksToReturn.length) {
      return this.chunksToReturn[this.parseCount++];
    }
    return {};
  }
}

describe("BaseSseAgent", () => {
  const sampleInput: AgentRequest = { messages: [] };

  afterEach(() => {
    spyOn(globalThis, "fetch").mockRestore();
  });

  function mockFetchWithSse(chunks: string[]) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    const mockResponse = new Response(stream, { status: 200, ok: true });
    spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as any);
  }

  test("stream yields tokens and tool calls via AsyncQueue", async () => {
    const agent = new TestBaseAgent();
    agent.chunksToReturn = [
      { token: "hel" },
      { token: "lo" },
      { toolCall: { name: "test", arguments: "{}" } },
      { done: true },
    ];

    // Simulate valid JSON SSE events
    mockFetchWithSse([
      'data: {"id":1}\\n\\n',
      'data: {"id":2}\\n\\n',
      'data: {"id":3}\\n\\n',
      'data: {"id":4}\\n\\n',
      'data: [DONE]\\n\\n'
    ]);

    const stream = await agent.stream(sampleInput);
    const events = [];
    for await (const event of stream.events) {
      events.push(event);
    }

    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({ type: "token", token: "hel" });
    expect(events[1]).toEqual({ type: "token", token: "lo" });
    expect(events[2]).toEqual({ type: "tool_call", toolCall: { name: "test", arguments: "{}" } });
    expect(events[3].type).toBe("done");
  });

  test("request accumulates tokens and returns final text", async () => {
    const agent = new TestBaseAgent();
    agent.chunksToReturn = [
      { token: "hello" },
      { token: " world" },
      { done: true },
    ];

    mockFetchWithSse([
      'data: {"id":1}\\n\\n',
      'data: {"id":2}\\n\\n',
      'data: {"id":3}\\n\\n'
    ]);

    const result = await agent.request(sampleInput);
    expect(result.text).toBe("hello world");
    expect(result.toolCalls).toHaveLength(0);
  });

  test("stream throws on non-200 upstream error", async () => {
    const agent = new TestBaseAgent();
    const mockResponse = new Response("Bad Request", { status: 400, ok: false });
    spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as any);

    await expect(agent.stream(sampleInput)).rejects.toThrow("Upstream error 400: Bad Request");
  });

  test("stream correctly skips invalid JSON payloads", async () => {
    const agent = new TestBaseAgent();
    agent.chunksToReturn = [
      { token: "valid" },
      { done: true }
    ];

    mockFetchWithSse([
      'data: INVALID_JSON\\n\\n',
      'data: {"valid":true}\\n\\n',
      'data: {"done":true}\\n\\n'
    ]);

    const stream = await agent.stream(sampleInput);
    const events = [];
    for await (const event of stream.events) {
      events.push(event);
    }

    expect(events).toHaveLength(2); // The valid token and done event
    expect(events[0]).toEqual({ type: "token", token: "valid" });
  });

  test("cancel terminates request early", async () => {
    const agent = new TestBaseAgent();

    let fetchSignal: AbortSignal | undefined;
    spyOn(globalThis, "fetch").mockImplementation(async (_, init) => {
      fetchSignal = (init as any)?.signal;
      // Return a never-resolving stream to simulate pending request
      return new Response(new ReadableStream(), { status: 200, ok: true });
    });

    const streamPromise = agent.stream(sampleInput);
    // Give event loop a tick to initiate fetch
    await new Promise((r) => setTimeout(r, 0));

    const stream = await streamPromise;
    expect(fetchSignal?.aborted).toBe(false);

    await agent.cancel(stream.requestId);
    expect(fetchSignal?.aborted).toBe(true);
  });
});

/**
 * Each adapter\\'s \`buildRequest\` and \`parseChunk\` are \`protected\`, so we expose`;

const newContent = content.replace(importSearch, replacement);

if (content === newContent) {
  console.error("Replacement failed, could not find exact match.");
  process.exit(1);
}

fs.writeFileSync("tests/agent-providers.test.ts", newContent);
console.log("Successfully patched tests/agent-providers.test.ts");
