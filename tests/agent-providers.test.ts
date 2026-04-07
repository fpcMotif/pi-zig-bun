import { describe, expect, test, spyOn, afterEach } from "bun:test";
import { BaseSseAgent, OpenAIAdapter, AnthropicAdapter, GoogleGenAIAdapter } from "../src/agent/providers";
import { createAgentFromEnv } from "../src/agent";
import type { AgentRequest, AgentToolCall } from "../src/agent/types";

// ---------------------------------------------------------------------------
// BaseSseAgent
// ---------------------------------------------------------------------------
class TestBaseAgent extends BaseSseAgent {
  public chunksToReturn: Array<{ token?: string; toolCall?: AgentToolCall; done?: boolean; finalText?: string }> = [];
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
    const mockResponse = new Response(stream, { status: 200 });
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
      'data: {"id":1}\n\n',
      'data: {"id":2}\n\n',
      'data: {"id":3}\n\n',
      'data: {"id":4}\n\n',
      'data: [DONE]\n\n'
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
      'data: {"id":1}\n\n',
      'data: {"id":2}\n\n',
      'data: {"id":3}\n\n'
    ]);

    const result = await agent.request(sampleInput);
    expect(result.text).toBe("hello world");
    expect(result.toolCalls).toHaveLength(0);
  });

  test("stream throws on non-200 upstream error", async () => {
    const agent = new TestBaseAgent();
    const mockResponse = new Response("Bad Request", { status: 400 });
    Object.defineProperty(mockResponse, 'ok', { value: false });
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
      'data: INVALID_JSON\n\n',
      'data: {"valid":true}\n\n',
      'data: {"done":true}\n\n'
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
    spyOn(globalThis, "fetch").mockImplementation(async (_: string | URL | Request, init?: RequestInit) => {
      fetchSignal = init?.signal as AbortSignal | undefined;
      // Return a never-resolving stream to simulate pending request
      return new Response(new ReadableStream(), { status: 200 });
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
 * Each adapter\'s `buildRequest` and `parseChunk` are `protected`, so we expose
 * them via minimal subclasses that delegate directly to the parent implementation.
 */
class TestableOpenAI extends OpenAIAdapter {
  public exposeBuildRequest(input: AgentRequest, stream: boolean) {
    return this.buildRequest(input, stream);
  }
  public exposeParseChunk(payload: unknown) {
    return this.parseChunk(payload);
  }
}

class TestableAnthropic extends AnthropicAdapter {
  public exposeBuildRequest(input: AgentRequest, stream: boolean) {
    return this.buildRequest(input, stream);
  }
  public exposeParseChunk(payload: unknown) {
    return this.parseChunk(payload);
  }
}

class TestableGoogle extends GoogleGenAIAdapter {
  public exposeBuildRequest(input: AgentRequest, stream: boolean) {
    return this.buildRequest(input, stream);
  }
  public exposeParseChunk(payload: unknown) {
    return this.parseChunk(payload);
  }
}

const sampleRequest: AgentRequest = {
  messages: [
    { role: "system", content: "you are helpful" },
    { role: "user", content: "hello" },
  ],
  temperature: 0.5,
};

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------
describe("OpenAIAdapter", () => {
  const adapter = new TestableOpenAI("sk-test-key", "gpt-4o");

  test("buildRequest produces correct URL and headers", () => {
    const { url, init } = adapter.exposeBuildRequest(sampleRequest, true);

    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer sk-test-key");
    expect(headers["content-type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gpt-4o");
    expect(body.stream).toBe(true);
    expect(body.temperature).toBe(0.5);
    expect(body.messages).toHaveLength(2);
  });

  test("buildRequest falls back to constructor model when request omits model", () => {
    const reqNoModel: AgentRequest = { messages: [{ role: "user", content: "hi" }] };
    const body = JSON.parse(adapter.exposeBuildRequest(reqNoModel, false).init.body as string);
    expect(body.model).toBe("gpt-4o");
    expect(body.stream).toBe(false);
  });

  test("parseChunk extracts token from delta content", () => {
    const chunk = adapter.exposeParseChunk({
      choices: [{ delta: { content: "hi" }, finish_reason: null }],
    });
    expect(chunk.token).toBe("hi");
    expect(chunk.done).toBe(false);
    expect(chunk.toolCall).toBeUndefined();
  });

  test("parseChunk detects finish_reason as done", () => {
    const chunk = adapter.exposeParseChunk({
      choices: [{ delta: {}, finish_reason: "stop" }],
    });
    expect(chunk.done).toBe(true);
  });

  test("parseChunk extracts tool call from delta", () => {
    const chunk = adapter.exposeParseChunk({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                id: "call_1",
                function: { name: "search", arguments: '{"q":"test"}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    expect(chunk.toolCall).toEqual({
      id: "call_1",
      name: "search",
      arguments: '{"q":"test"}',
    });
  });

  test("parseChunk returns undefined token when delta has no content", () => {
    const chunk = adapter.exposeParseChunk({ choices: [{ delta: {}, finish_reason: null }] });
    expect(chunk.token).toBeUndefined();
  });
});

describe("createAgentFromEnv", () => {
  function withEnv(temp: Record<string, string | undefined>, fn: () => void): void {
    const original = new Map<string, string | undefined>();
    Object.keys(temp).forEach((key) => {
      original.set(key, process.env[key]);
    });
    Object.entries(temp).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    try {
      fn();
    } finally {
      Object.entries(temp).forEach(([key]) => {
        const value = original.get(key);
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
    }
  }

  test("uses ANTHROPIC_MAX_TOKENS when provided", () => {
    withEnv(
      {
        PI_AGENT_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "ant-test-key",
        ANTHROPIC_MODEL: "claude-3-5-sonnet-latest",
        ANTHROPIC_MAX_TOKENS: "8192",
      },
      () => {
        const adapter = createAgentFromEnv() as unknown as {
          buildRequest: (input: AgentRequest, stream: boolean) => { init: { body: string } };
        };
        const body = JSON.parse(
          adapter.buildRequest({ messages: [{ role: "user", content: "hi" }] }, false).init.body as string,
        );
        expect(body.max_tokens).toBe(8192);
      },
    );
  });

  test("uses default ANTHROPIC_MAX_TOKENS when env var is unset", () => {
    withEnv(
      {
        PI_AGENT_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "ant-test-key",
        ANTHROPIC_MODEL: "claude-3-5-sonnet-latest",
      },
      () => {
        const adapter = createAgentFromEnv() as unknown as {
          buildRequest: (input: AgentRequest, stream: boolean) => { init: { body: string } };
        };
        const body = JSON.parse(
          adapter.buildRequest({ messages: [{ role: "user", content: "hi" }] }, false).init.body as string,
        );
        expect(body.max_tokens).toBe(4096);
      },
    );
  });

  test("rejects non-positive ANTHROPIC_MAX_TOKENS", () => {
    withEnv(
      {
        PI_AGENT_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "ant-test-key",
        ANTHROPIC_MAX_TOKENS: "0",
      },
      () => {
        expect(() => createAgentFromEnv()).toThrow("ANTHROPIC_MAX_TOKENS must be a positive integer");
      },
    );

    withEnv(
      {
        PI_AGENT_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "ant-test-key",
        ANTHROPIC_MAX_TOKENS: "-10",
      },
      () => {
        expect(() => createAgentFromEnv()).toThrow("ANTHROPIC_MAX_TOKENS must be a positive integer");
      },
    );

    withEnv(
      {
        PI_AGENT_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "ant-test-key",
        ANTHROPIC_MAX_TOKENS: "abc",
      },
      () => {
        expect(() => createAgentFromEnv()).toThrow("ANTHROPIC_MAX_TOKENS must be a positive integer");
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------
describe("AnthropicAdapter", () => {
  const adapter = new TestableAnthropic("ant-test-key", "claude-3-5-sonnet-latest");

  test("buildRequest produces correct URL and headers", () => {
    const { url, init } = adapter.exposeBuildRequest(sampleRequest, true);

    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("ant-test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["content-type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-3-5-sonnet-latest");
    expect(body.max_tokens).toBe(4096);
    expect(body.stream).toBe(true);
  });

  test("buildRequest filters out system messages from the messages array", () => {
    const body = JSON.parse(
      adapter.exposeBuildRequest(sampleRequest, false).init.body as string,
    );
    const roles = body.messages.map((m: { role: string }) => m.role);
    expect(roles).not.toContain("system");
    expect(roles).toEqual(["user"]);
  });

  test("parseChunk extracts text from content_block_delta", () => {
    const chunk = adapter.exposeParseChunk({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "world" },
    });
    expect(chunk.token).toBe("world");
    expect(chunk.done).toBeFalsy();
  });

  test("parseChunk extracts tool call from content_block_start", () => {
    const chunk = adapter.exposeParseChunk({
      type: "content_block_start",
      content_block: { type: "tool_use", id: "tu_1", name: "read", input: { path: "a.txt" } },
    });
    expect(chunk.toolCall).toEqual({
      id: "tu_1",
      name: "read",
      arguments: JSON.stringify({ path: "a.txt" }),
    });
  });

  test("parseChunk recognises message_stop as done", () => {
    const chunk = adapter.exposeParseChunk({ type: "message_stop" });
    expect(chunk.done).toBe(true);
  });

  test("parseChunk returns not-done for unrecognised payload types", () => {
    const chunk = adapter.exposeParseChunk({ type: "ping" });
    expect(chunk.done).toBe(false);
    expect(chunk.token).toBeUndefined();
    expect(chunk.toolCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Google Generative AI
// ---------------------------------------------------------------------------
describe("GoogleGenAIAdapter", () => {
  const adapter = new TestableGoogle("goog-test-key", "gemini-1.5-flash");

  test("buildRequest produces correct streaming URL with API key in header", () => {
    const { url, init } = adapter.exposeBuildRequest(sampleRequest, true);

    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent",
    );
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    // API key is sent via header, not query string, to prevent leaking in logs.
    expect(headers["x-goog-api-key"]).toBe("goog-test-key");
    expect(url).not.toContain("key=");
  });

  test("buildRequest uses generateContent for non-streaming requests", () => {
    const { url } = adapter.exposeBuildRequest(sampleRequest, false);
    expect(url).toContain(":generateContent");
    expect(url).not.toContain("stream");
  });

  test("buildRequest maps messages to Google contents format", () => {
    const body = JSON.parse(
      adapter.exposeBuildRequest(sampleRequest, false).init.body as string,
    );
    // system -> "user", assistant -> "model"
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "you are helpful" }] },
      { role: "user", parts: [{ text: "hello" }] },
    ]);
  });

  test("parseChunk extracts text from candidates", () => {
    const chunk = adapter.exposeParseChunk({
      candidates: [{ content: { parts: [{ text: "hi" }] } }],
    });
    expect(chunk.token).toBe("hi");
    expect(chunk.done).toBe(false);
  });

  test("parseChunk concatenates multiple parts", () => {
    const chunk = adapter.exposeParseChunk({
      candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }],
    });
    expect(chunk.token).toBe("ab");
  });

  test("parseChunk detects finishReason as done", () => {
    const chunk = adapter.exposeParseChunk({
      candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }],
    });
    expect(chunk.done).toBe(true);
  });

  test("parseChunk returns undefined token for empty text", () => {
    const chunk = adapter.exposeParseChunk({
      candidates: [{ content: { parts: [] } }],
    });
    expect(chunk.token).toBeUndefined();
  });
});
