import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { TuiRenderer } from "../src/tui/renderer";

describe("TuiRenderer", () => {
  let mockWrite: ReturnType<typeof mock>;
  let mockStream: NodeJS.WriteStream;
  let renderer: TuiRenderer;

  beforeEach(() => {
    mockWrite = mock(() => true);
    mockStream = {
      write: mockWrite,
    } as unknown as NodeJS.WriteStream;
    renderer = new TuiRenderer(mockStream);
  });

  afterEach(() => {
    mock.restore();
    renderer.stopThinking(); // Ensure timers are cleared
  });

  // --- Basic initialization & helper checks ---

  it("should initialize without errors", () => {
    expect(renderer).toBeDefined();
  });

  it("clear() should send cursor to col 0 and clear the line", () => {
    renderer.clear();
    expect(mockWrite).toHaveBeenCalledWith("\r\x1b[2K");
  });

  it("writeAssistantPrefix() should print bold blue prefix", () => {
    renderer.writeAssistantPrefix();
    expect(mockWrite).toHaveBeenCalledWith("\x1b[1m\x1b[34massistant> \x1b[0m");
  });

  it("writeToken() should just write the raw token", () => {
    renderer.writeToken("hello");
    expect(mockWrite).toHaveBeenCalledWith("hello");
  });

  it("writeToolCall() should format the tool call block", () => {
    renderer.writeToolCall("my_tool", "{}");
    expect(mockWrite).toHaveBeenCalledWith("\x1b[1m\x1b[33m\n[tool_call my_tool]\x1b[0m\x1b[2m\x1b[33m {}\x1b[0m");
  });

  it("writeToolExecution() should indicate tool is running", () => {
    renderer.writeToolExecution("my_tool");
    expect(mockWrite).toHaveBeenCalledWith("\x1b[2m\x1b[36m\n  executing my_tool...\x1b[0m");
  });

  it("writeToolExecutionDone() should mark execution complete", () => {
    renderer.writeToolExecutionDone();
    expect(mockWrite).toHaveBeenCalledWith("\x1b[32m done\x1b[0m");
  });

  it("writeToolLoopCeiling() should warn when loop hits limit", () => {
    renderer.writeToolLoopCeiling(10);
    expect(mockWrite).toHaveBeenCalledWith("\x1b[1m\x1b[33m\n[agent] tool-call loop hit ceiling (10 rounds)\n\x1b[0m");
  });

  it("writeError() should output red error message", () => {
    renderer.writeError("test error");
    expect(mockWrite).toHaveBeenCalledWith("\x1b[1m\x1b[31m\n[error] test error\n\x1b[0m");
  });

  it("writeBanner() should output a styled banner", () => {
    renderer.writeBanner();
    expect(mockWrite).toHaveBeenCalledTimes(2);
    const args = mockWrite.mock.calls.map(c => c[0]);
    expect(args[0]).toBe("\x1b[1m\x1b[35mpi-zig-bun interactive\n\x1b[0m");
    expect(args[1]).toBe("\x1b[2m\x1b[90mType /help for commands.\n\x1b[0m");
  });

  it("promptString() should return the properly formatted string", () => {
    const prompt = renderer.promptString();
    expect(prompt).toBe("\x01\x1b[1m\x1b[32m\x02pi> \x01\x1b[0m\x02");
  });

  it("writeNewline() should output just a newline", () => {
    renderer.writeNewline();
    expect(mockWrite).toHaveBeenCalledWith("\n");
  });

  // --- Spinner Tests ---
  describe("Thinking Spinner", () => {
    beforeEach(() => {
      // Setup fake timers for tests relying on setInterval
      // Bun test natively supports fake timers! (bun >= 1.0.30+)
      // but if not, we can just spy on setInterval and see it's called
      spyOn(global, "setInterval");
      spyOn(global, "clearInterval");
    });

    afterEach(() => {
      // restore the original timers
      mock.restore();
    });

    it("startThinking() should hide cursor, render first frame and start interval", () => {
      renderer.startThinking();

      // hide cursor
      expect(mockWrite).toHaveBeenCalledWith("\x1b[?25l");

      // frame render
      // clear
      expect(mockWrite).toHaveBeenCalledWith("\r\x1b[2K");
      // draw first frame (\u2800) styled
      expect(mockWrite).toHaveBeenCalledWith("\x1b[2m\x1b[36m\u2800 thinking...\x1b[0m");

      expect(global.setInterval).toHaveBeenCalledTimes(1);
    });

    it("startThinking() should be a no-op if already active", () => {
      renderer.startThinking();
      mockWrite.mockClear();
      (global.setInterval as ReturnType<typeof mock>).mockClear();

      renderer.startThinking();

      expect(mockWrite).not.toHaveBeenCalled();
      expect(global.setInterval).not.toHaveBeenCalled();
    });

    it("stopThinking() should be a no-op if not active", () => {
      renderer.stopThinking();
      expect(mockWrite).not.toHaveBeenCalled();
      expect(global.clearInterval).not.toHaveBeenCalled();
    });

    it("stopThinking() should stop interval, clear line and show cursor", () => {
      renderer.startThinking();
      mockWrite.mockClear();

      renderer.stopThinking();

      // clears interval
      expect(global.clearInterval).toHaveBeenCalledTimes(1);

      // clear
      expect(mockWrite).toHaveBeenCalledWith("\r\x1b[2K");

      // show cursor
      expect(mockWrite).toHaveBeenCalledWith("\x1b[?25h");
    });
  });
});
