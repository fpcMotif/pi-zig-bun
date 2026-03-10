import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/cli";

describe("CLI parser", () => {
  test("TC-CLI-001 parses search with flags", () => {
    const parsed = parseCli(["--json", "--limit", "12", "search", "hello", "world"]);
    expect(parsed.command).toBe("search");
    expect(parsed.query).toBe("hello world");
    expect(parsed.json).toBeTrue();
    expect(parsed.limit).toBe(12);
  });

  test("TC-CLI-002 defaults invalid limit to 50", () => {
    const parsed = parseCli(["--limit", "NaN", "search", "x"]);
    expect(parsed.limit).toBe(50);
  });

  test("TC-CLI-003 explicit help command", () => {
    const parsed = parseCli(["--help"]);
    expect(parsed.command).toBe("help");
  });
});
