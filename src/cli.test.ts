import { describe, expect, test } from "bun:test";
import { parseCli } from "./cli";

describe("parseCli", () => {
  test("routes -p as one-shot search query", () => {
    const parsed = parseCli(["-p", "needle"]);
    expect(parsed.command).toBe("search");
    expect(parsed.query).toBe("needle");
    expect(parsed.json).toBe(false);
  });

  test("routes --json query without explicit command", () => {
    const parsed = parseCli(["--json", "needle"]);
    expect(parsed.command).toBe("search");
    expect(parsed.query).toBe("needle");
    expect(parsed.json).toBe(true);
  });

  test("command precedence rejects one-shot flags mixed with explicit command", () => {
    expect(() => parseCli(["-p", "x", "grep", "needle"])).toThrow(
      "Cannot combine one-shot query flags with explicit command",
    );
  });

  test("invalid args: unknown flag", () => {
    expect(() => parseCli(["--wat"])).toThrow("Unknown flag: --wat");
  });

  test("expected command routing for /login", () => {
    const parsed = parseCli(["/login"]);
    expect(parsed.command).toBe("login");
  });
});
