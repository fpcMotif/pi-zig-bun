import type { StreamEvent } from "./types";

function decodeChunk(chunk: Uint8Array): string {
  return new TextDecoder().decode(chunk);
}

export async function parseChunkedTextStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
): Promise<string> {
  const reader = body.getReader();
  let aggregate = "";

  while (true) {
    const result = await reader.read();
    if (result.done) {
      onEvent({ type: "done" });
      return aggregate;
    }

    const text = decodeChunk(result.value);
    if (text.length > 0) {
      aggregate += text;
      onEvent({ type: "token", token: text });
    }
  }
}

export async function parseSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
  extractToken: (payload: unknown) => string | undefined,
): Promise<string> {
  const reader = body.getReader();
  let pending = "";
  let aggregate = "";

  const processEvent = (raw: string): boolean => {
    const lines = raw.split("\n");
    const dataLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) {
        continue;
      }
      dataLines.push(trimmed.slice("data:".length).trim());
    }

    if (dataLines.length === 0) {
      return false;
    }

    const payloadText = dataLines.join("\n");
    if (payloadText === "[DONE]") {
      onEvent({ type: "done" });
      return true;
    }

    try {
      const payload = JSON.parse(payloadText) as unknown;
      const token = extractToken(payload);
      onEvent({ type: "meta", data: payload });
      if (token && token.length > 0) {
        aggregate += token;
        onEvent({ type: "token", token });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent({ type: "error", message: `Failed to parse SSE payload: ${message}` });
    }

    return false;
  };

  while (true) {
    const result = await reader.read();
    if (result.done) {
      if (pending.trim().length > 0) {
        processEvent(pending);
      }
      onEvent({ type: "done" });
      return aggregate;
    }

    pending += decodeChunk(result.value);

    let sepIndex = pending.indexOf("\n\n");
    while (sepIndex !== -1) {
      const eventChunk = pending.slice(0, sepIndex);
      pending = pending.slice(sepIndex + 2);
      const shouldStop = processEvent(eventChunk);
      if (shouldStop) {
        return aggregate;
      }
      sepIndex = pending.indexOf("\n\n");
    }
  }
}
