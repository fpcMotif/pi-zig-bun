import { describe, expect, test } from "bun:test";
import { parseSse, type SseEvent } from "../src/agent/sse";

/**
 * Helper: create a ReadableStream<Uint8Array> from an array of string chunks.
 * Each string is encoded independently so we can simulate partial delivery.
 */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]!));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/** Collect every event emitted by the async generator into an array. */
async function collectEvents(stream: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of parseSse(stream)) {
    events.push(event);
  }
  return events;
}

describe("parseSse", () => {
  test("parses a basic SSE event with event type and data", async () => {
    const raw = "event: message\ndata: hello world\n\n";
    const events = await collectEvents(streamFromChunks([raw]));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: "message", data: "hello world" });
  });

  test("parses multi-line data fields into a single newline-joined string", async () => {
    const raw = "data: line one\ndata: line two\ndata: line three\n\n";
    const events = await collectEvents(streamFromChunks([raw]));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ data: "line one\nline two\nline three" });
  });

  test("preserves single leading space for indented data fields", async () => {
    const raw = "data:  indented\n\n";
    const events = await collectEvents(streamFromChunks([raw]));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ data: " indented" });
  });

  test("handles CRLF line endings", async () => {
    const raw = "event: update\r\ndata: payload\r\n\r\n";
    const events = await collectEvents(streamFromChunks([raw]));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: "update", data: "payload" });
  });

  test("skips SSE comment lines (lines starting with colon)", async () => {
    const raw = ": this is a keep-alive comment\ndata: real data\n\n";
    const events = await collectEvents(streamFromChunks([raw]));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ data: "real data" });
  });

  test("handles multiple empty lines between events without emitting spurious events", async () => {
    const raw = "data: first\n\n\n\ndata: second\n\n";
    const events = await collectEvents(streamFromChunks([raw]));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ data: "first" });
    expect(events[1]).toEqual({ data: "second" });
  });

  test("flushes remaining data when stream ends with a newline but no trailing blank line", async () => {
    // The parser only processes lines when it encounters '\n'.
    // A data line followed by a newline gets parsed, then flush() runs at stream end.
    const raw = "data: trailing\n";
    const events = await collectEvents(streamFromChunks([raw]));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ data: "trailing" });
  });

  test("does not emit when stream ends mid-line without any newline", async () => {
    // Without '\n', the data line stays in the buffer and never gets parsed
    const raw = "data: incomplete";
    const events = await collectEvents(streamFromChunks([raw]));

    expect(events).toHaveLength(0);
  });

  test("does not emit events for empty data blocks (blank-line only)", async () => {
    const raw = "\n\n\n";
    const events = await collectEvents(streamFromChunks([raw]));

    expect(events).toHaveLength(0);
  });

  test("handles data split across multiple stream chunks", async () => {
    const chunks = ["data: hel", "lo wo", "rld\n\n"];
    const events = await collectEvents(streamFromChunks(chunks));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ data: "hello world" });
  });

  test("parses two consecutive events delivered in one chunk", async () => {
    const raw = "event: a\ndata: alpha\n\nevent: b\ndata: beta\n\n";
    const events = await collectEvents(streamFromChunks([raw]));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ event: "a", data: "alpha" });
    expect(events[1]).toEqual({ event: "b", data: "beta" });
  });

  test("omits the event field when no event: line is present", async () => {
    const raw = "data: no-event-type\n\n";
    const events = await collectEvents(streamFromChunks([raw]));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ data: "no-event-type" });
    expect("event" in events[0]!).toBe(false);
  });
});
