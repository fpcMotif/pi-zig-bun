import { describe, expect, test, beforeEach, afterEach, jest } from "bun:test";
import { TuiRenderer } from "../../../src/tui/renderer";

describe("TuiRenderer", () => {
  let mockStream: NodeJS.WriteStream;
  let renderer: TuiRenderer;
  let writtenData: string[];

  beforeEach(() => {
    writtenData = [];
    mockStream = {
      write: (str: string) => {
        writtenData.push(str);
        return true;
      },
    } as NodeJS.WriteStream;

    renderer = new TuiRenderer(mockStream);
    // Bun's native jest implementation doesn't support advanceTimersByTime out of the box
    // But we can test async timer functions by using real timers and wait
  });

  afterEach(() => {
    renderer.stopThinking();
  });

  test("clear writes the clear line ansi sequence", () => {
    renderer.clear();
    expect(writtenData.join("")).toContain("\r\x1b[2K");
  });

  test("writeToken appends a token", () => {
    renderer.writeToken("hello");
    renderer.writeToken(" world");
    expect(writtenData.join("")).toBe("hello world");
  });

  test("writeAssistantPrefix writes formatted prefix", () => {
    renderer.writeAssistantPrefix();
    expect(writtenData.join("")).toContain("assistant> ");
    // Includes bold and blue ANSI codes
    expect(writtenData.join("")).toContain("\x1b[1m\x1b[34m");
    expect(writtenData.join("")).toContain("\x1b[0m");
  });

  test("spinner writes frames periodically", async () => {
    renderer.startThinking();

    // Hide cursor + first frame
    expect(writtenData.join("")).toContain("\x1b[?25l");
    expect(writtenData.join("")).toContain("thinking...");

    const initialDataLength = writtenData.length;

    // Advance time by one frame interval (80ms + some buffer)
    await new Promise((r) => setTimeout(r, 100));

    expect(writtenData.length).toBeGreaterThan(initialDataLength);
  });

  test("stopThinking restores cursor and cleans up interval", async () => {
    renderer.startThinking();

    // Clear written data to focus on what happens during stop
    writtenData.length = 0;

    renderer.stopThinking();

    // Check line is cleared and cursor is shown
    const output = writtenData.join("");
    expect(output).toContain("\r\x1b[2K");
    expect(output).toContain("\x1b[?25h");

    writtenData.length = 0;

    // Waiting should not write any more frames
    await new Promise((r) => setTimeout(r, 100));
    expect(writtenData.length).toBe(0);
  });

  test("multiple stopThinking calls do not throw", () => {
    renderer.stopThinking();
    renderer.stopThinking();
  });

  test("startThinking when already active does not duplicate interval", () => {
    renderer.startThinking();
    const interval1 = (renderer as any).spinnerTimer;

    renderer.startThinking();
    const interval2 = (renderer as any).spinnerTimer;

    expect(interval1).toBe(interval2);
  });

  test("writeError writes formatted error message", () => {
    renderer.writeError("test error");
    const output = writtenData.join("");
    expect(output).toContain("[error] test error");
    expect(output).toContain("\x1b[31m"); // red
  });

  test("writeToolExecution writes formatted execution message", () => {
    renderer.writeToolExecution("testTool");
    const output = writtenData.join("");
    expect(output).toContain("executing testTool...");
    expect(output).toContain("\x1b[36m"); // cyan
  });

  test("writeToolCall writes formatted tool call message", () => {
    renderer.writeToolCall("testTool", '{"arg": 1}');
    const output = writtenData.join("");
    expect(output).toContain("[tool_call testTool]");
    expect(output).toContain('{"arg": 1}');
    expect(output).toContain("\x1b[33m"); // yellow
  });

  test("writeToolExecutionDone writes 'done'", () => {
    renderer.writeToolExecutionDone();
    const output = writtenData.join("");
    expect(output).toContain(" done");
    expect(output).toContain("\x1b[32m"); // green
  });

  test("writeToolLoopCeiling writes formatted ceiling message", () => {
    renderer.writeToolLoopCeiling(42);
    const output = writtenData.join("");
    expect(output).toContain("tool-call loop hit ceiling (42 rounds)");
    expect(output).toContain("\x1b[33m"); // yellow
  });

  test("writeBanner writes the banner", () => {
    renderer.writeBanner();
    const output = writtenData.join("");
    expect(output).toContain("pi-zig-bun interactive");
    expect(output).toContain("Type /help for commands.");
    expect(output).toContain("\x1b[35m"); // magenta
  });

  test("writeNewline writes a newline", () => {
    renderer.writeNewline();
    expect(writtenData.join("")).toBe("\n");
  });

  test("promptString returns correct formatted prompt string with readline brackets", () => {
    const prompt = renderer.promptString();
    expect(prompt).toContain("pi> ");
    // Includes readline non-printable brackets \x01 and \x02 around ANSI codes
    expect(prompt).toContain("\x01\x1b[1m\x1b[32m\x02");
    expect(prompt).toContain("\x01\x1b[0m\x02");
  });
});
