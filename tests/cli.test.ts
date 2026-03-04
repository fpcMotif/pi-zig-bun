import { describe, expect, test } from "bun:test";
import { parseCli } from "../src/cli";

describe("parseCli", () => {
  test("parses command, query, and flags", () => {
    const parsed = parseCli(["-j", "--cwd", "/repo", "--limit", "20", "search", "needle"]);
    expect(parsed.command).toBe("search");
    expect(parsed.query).toBe("needle");
    expect(parsed.json).toBe(true);
    expect(parsed.cwd).toBe("/repo");
    expect(parsed.limit).toBe(20);
  });

  test("uses interactive mode by default", () => {
    const parsed = parseCli([]);
    expect(parsed.command).toBe("interactive");
    expect(parsed.help).toBe(false);
  });

  test("maps help flag to help command when provided before command", () => {
    const parsed = parseCli(["--help", "search", "foo"]);
    expect(parsed.command).toBe("help");
    expect(parsed.help).toBe(true);
  });

  test("treats flags after command as query tokens", () => {
    const parsed = parseCli(["search", "foo", "--help"]);
    expect(parsed.command).toBe("search");
    expect(parsed.query).toBe("foo --help");
  });

  test("falls back to default limit for invalid values", () => {
    expect(parseCli(["search", "foo", "--limit", "0"]).limit).toBe(50);
    expect(parseCli(["search", "foo", "--limit", "NaN"]).limit).toBe(50);
  });

  test("accepts unknown command token and keeps raw query tokens", () => {
    const parsed = parseCli(["unknown", "a", "b"]);
    expect(parsed.command).toBe("interactive");
    expect(parsed.query).toBeUndefined();
  });

  test("throws when required option value is missing", () => {
    expect(() => parseCli(["--cwd"])).toThrow("Missing value for --cwd");
    expect(() => parseCli(["--limit"])).toThrow("Missing value for --limit");
    expect(() => parseCli(["--root-session"])).toThrow("Missing value for --root-session");
  });
});
