import { describe, expect, test, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { run } from "../src/main";
import * as SearchClientModule from "../src/search/client";

describe("main run function", () => {
  let logSpy: ReturnType<typeof mock>;
  let errSpy: ReturnType<typeof mock>;
  let searchClientMock: ReturnType<typeof mock>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errSpy = spyOn(console, "error").mockImplementation(() => {});

    // Mock SearchClient.from to avoid needing the zig binary
    searchClientMock = mock(() => ({
      ensureInitialized: mock(async () => {}),
      searchFiles: mock(async () => ({ results: [] })),
      grep: mock(async () => ({ matches: [] })),
      uiUpdate: mock(async () => ({})),
      uiInput: mock(async () => ({})),
      stop: mock(async () => {}),
    }));
    SearchClientModule.SearchClient.from = searchClientMock;
  });

  afterEach(() => {
    mock.restore();
  });

  test("prints usage and returns 0 when --help is provided", async () => {
    const code = await run(["--help"]);
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("Usage:");
  });

  test("returns 2 and prints error when search lacks a query", async () => {
    const code = await run(["search"]);
    expect(code).toBe(2);
    expect(errSpy).toHaveBeenCalled();
    const output = errSpy.mock.calls.flat().join("\n");
    expect(output).toContain("search requires <query>");
  });

  test("returns 2 and prints error when grep lacks a query", async () => {
    const code = await run(["grep"]);
    expect(code).toBe(2);
    expect(errSpy).toHaveBeenCalled();
    const output = errSpy.mock.calls.flat().join("\n");
    expect(output).toContain("grep requires <query>");
  });

  test("returns 1 and prints error when session lacks --root-session", async () => {
    const code = await run(["session"]);
    expect(code).toBe(1);
    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("Session subcommand usage: session --root-session <id>");
  });
});
