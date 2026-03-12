import { describe, expect, test, spyOn } from "bun:test";
import { run } from "../src/main";
import { usage } from "../src/cli";

describe("main run()", () => {
  test("TC-MAIN-001 run(['--help']) prints usage and returns 0", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    try {
      const result = await run(["--help"]);

      expect(result).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(usage());
    } finally {
      logSpy.mockRestore();
    }
  });
});
