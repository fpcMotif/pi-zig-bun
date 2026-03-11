import { parseSse } from "./sse";
import type { AgentAdapter, AgentRequest, AgentResponse, AgentStream, AgentStreamEvent, AgentToolCall } from "./types";

const activeControllers = new Map<string, AbortController>();

class AsyncQueue<T> {
  private buffer: T[] = [];
  private resolve: ((value: IteratorResult<T, void>) => void) | null = null;
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  close(): void {
    this.closed = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T, void> {
    return {
      next: (): Promise<IteratorResult<T, void>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<T, void>>((resolve) => {
          this.resolve = resolve;
        });
      },
    };
  }
}

abstract class BaseSseAgent implements AgentAdapter {
  protected abstract buildRequest(input: AgentRequest, stream: boolean): { url: string; init: RequestInit };
  protected abstract parseChunk(payload: unknown): { token?: string; done?: boolean; toolCall?: AgentToolCall; finalText?: string };

  public async request(input: AgentRequest): Promise<AgentResponse> {
    const stream = await this.stream(input);
    let text = "";
    const toolCalls: AgentToolCall[] = [];

    for await (const event of stream.events) {
      if (event.type === "token") {
        text += event.token;
      } else if (event.type === "tool_call") {
        toolCalls.push(event.toolCall);
      } else if (event.type === "done") {
        await stream.cancel();
        return event.response;
      } else if (event.type === "error") {
        await stream.cancel();
        throw new Error(event.error);
      }
    }

    await stream.cancel();
    return { text, toolCalls };
  }

  public async stream(input: AgentRequest): Promise<AgentStream> {
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    activeControllers.set(requestId, controller);

    const { url, init } = this.buildRequest(input, true);

    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      activeControllers.delete(requestId);
      throw err;
    }
    if (!response.ok || !response.body) {
      activeControllers.delete(requestId);
      throw new Error(`Upstream error ${response.status}: ${await response.text()}`);
    }

    const channel = new AsyncQueue<AgentStreamEvent>();
    let text = "";
    const toolCalls: AgentToolCall[] = [];

    (async () => {
      let finished = false;
      try {
        for await (const event of parseSse(response.body!)) {
          if (event.data === "[DONE]") {
            break;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(event.data);
          } catch {
            continue;
          }

          const chunk = this.parseChunk(parsed);
          if (chunk.token) {
            text += chunk.token;
            channel.push({ type: "token", token: chunk.token });
          }
          if (chunk.toolCall) {
            toolCalls.push(chunk.toolCall);
            channel.push({ type: "tool_call", toolCall: chunk.toolCall });
          }
          if (chunk.done) {
            const finalText = chunk.finalText ?? text;
            channel.push({ type: "done", response: { text: finalText, toolCalls: [...toolCalls], raw: parsed } });
            finished = true;
            break;
          }
        }
        if (!finished) {
          channel.push({ type: "done", response: { text, toolCalls: [...toolCalls] } });
        }
      } catch (err) {
        channel.push({ type: "error", error: (err as Error).message });
      } finally {
        channel.close();
      }
    })();

    return {
      requestId,
      events: channel,
      cancel: async () => {
        controller.abort();
        activeControllers.delete(requestId);
      },
    };
  }

  public async cancel(requestId: string): Promise<void> {
    activeControllers.get(requestId)?.abort();
    activeControllers.delete(requestId);
  }
}

export class OpenAIAdapter extends BaseSseAgent {
  constructor(private readonly apiKey: string, private readonly model = "gpt-4o-mini") {
    super();
  }

  protected buildRequest(input: AgentRequest, stream: boolean): { url: string; init: RequestInit } {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: input.model ?? this.model, messages: input.messages, temperature: input.temperature ?? 0.2, stream }),
      },
    };
  }

  protected parseChunk(payload: any) {
    const choice = payload?.choices?.[0];
    const delta = choice?.delta;
    const token = typeof delta?.content === "string" ? delta.content : undefined;
    const toolCall = delta?.tool_calls?.[0]
      ? { id: delta.tool_calls[0].id, name: delta.tool_calls[0].function?.name ?? "tool", arguments: delta.tool_calls[0].function?.arguments ?? "{}" }
      : undefined;
    return { token, toolCall, done: choice?.finish_reason != null };
  }
}

export class AnthropicAdapter extends BaseSseAgent {
  constructor(
    private readonly apiKey: string,
    private readonly model = "claude-3-5-sonnet-latest",
    private readonly maxTokens = 4096,
  ) {
    super();
  }

  protected buildRequest(input: AgentRequest, stream: boolean): { url: string; init: RequestInit } {
    return {
      url: "https://api.anthropic.com/v1/messages",
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model: input.model ?? this.model, max_tokens: this.maxTokens, messages: input.messages.filter((m) => m.role !== "system"), stream }),
      },
    };
  }

  protected parseChunk(payload: any) {
    if (payload?.type === "content_block_delta" && payload?.delta?.type === "text_delta") {
      return { token: payload.delta.text };
    }
    if (payload?.type === "content_block_start" && payload?.content_block?.type === "tool_use") {
      return {
        toolCall: {
          id: payload.content_block.id,
          name: payload.content_block.name ?? "tool",
          arguments: JSON.stringify(payload.content_block.input ?? {}),
        },
      };
    }
    return { done: payload?.type === "message_stop" };
  }
}

export class GoogleGenAIAdapter extends BaseSseAgent {
  constructor(private readonly apiKey: string, private readonly model = "gemini-1.5-flash") {
    super();
  }

  protected buildRequest(input: AgentRequest, stream: boolean): { url: string; init: RequestInit } {
    const method = stream ? "streamGenerateContent" : "generateContent";
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${input.model ?? this.model}:${method}`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({ contents: input.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })) }),
      },
    };
  }

  protected parseChunk(payload: any) {
    const text = payload?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    return { token: text || undefined, done: Boolean(payload?.candidates?.[0]?.finishReason) };
  }
}
