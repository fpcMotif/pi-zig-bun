import { describe, expect, test } from "bun:test";
import { OpenAIAdapter, AnthropicAdapter, GoogleGenAIAdapter } from "../src/agent/providers";
import { createAgentFromEnv } from "../src/agent";
import type { AgentRequest } from "../src/agent/types";

/**
 * Each adapter's `buildRequest` and `parseChunk` are `protected`, so we expose
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
