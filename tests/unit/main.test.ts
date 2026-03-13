import { describe, expect, test, spyOn } from "bun:test";
import { run } from "../../src/main";
import { usage } from "../../src/cli";

describe("run CLI entrypoint", () => {
  test("returns 0 and prints usage when --help is passed", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const exitCode = await run(["--help"]);
      expect(exitCode).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(usage());
    } finally {
      logSpy.mockRestore();
    }
  });
});
