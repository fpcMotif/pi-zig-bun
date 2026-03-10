import { ProviderError } from "./types";

export interface SseEvent {
  event?: string;
  data: string;
}

export async function* parseSseStream(response: Response): AsyncGenerator<SseEvent> {
  if (!response.ok) {
    throw new ProviderError("network_error", `Request failed with status ${response.status}`);
  }

  if (!response.body) {
    throw new ProviderError("invalid_response", "Provider response body was empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseEvent(rawEvent);
      if (parsed.data.length > 0) {
        yield parsed;
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  if (buffer.trim().length > 0) {
    const parsed = parseSseEvent(buffer);
    if (parsed.data.length > 0) {
      yield parsed;
    }
  }
}

function parseSseEvent(raw: string): SseEvent {
  const lines = raw.split("\n");
  const data: string[] = [];
  let event: string | undefined;

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }

  return { event, data: data.join("\n") };
}
