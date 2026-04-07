import { describe, expect, test, spyOn } from "bun:test";
import { run } from "../../src/main";
import { usage } from "../../src/cli";

describe("run CLI entrypoint", () => {
  test("returns 0 and prints usage when --help is passed", async () => {
    const logSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const exitCode = await run(["--help"]);
      expect(exitCode).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(usage() + "\n");
    } finally {
      logSpy.mockRestore();
    }
  });
});
