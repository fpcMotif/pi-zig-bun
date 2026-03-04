export interface SseEvent {
  event?: string;
  data: string;
}

export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let currentData: string[] = [];

  const flush = () => {
    if (currentData.length === 0) {
      currentEvent = "";
      return null;
    }
    const payload: SseEvent = {
      ...(currentEvent ? { event: currentEvent } : {}),
      data: currentData.join("\n"),
    };
    currentEvent = "";
    currentData = [];
    return payload;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      const last = flush();
      if (last) {
        yield last;
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx === -1) {
        break;
      }
      const rawLine = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

      if (line.length === 0) {
        const event = flush();
        if (event) {
          yield event;
        }
        continue;
      }

      if (line.startsWith(":")) {
        continue;
      }

      if (line.startsWith("event:")) {
        currentEvent = line.slice("event:".length).trim();
        continue;
      }

      if (line.startsWith("data:")) {
        currentData.push(line.slice("data:".length).trimStart());
      }
    }
  }
}
