import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { run } from "../src/main";
import { usage } from "../src/cli";

describe("main application entrypoint", () => {
  let originalConsoleLog: typeof console.log;
  let logMock: ReturnType<typeof mock>;

  beforeEach(() => {
    originalConsoleLog = console.log;
    logMock = mock();
    console.log = logMock;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  test("run with --help prints usage and exits with 0", async () => {
    const exitCode = await run(["--help"]);

    expect(exitCode).toBe(0);
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock.mock.calls[0][0]).toBe(usage());
  });
});
