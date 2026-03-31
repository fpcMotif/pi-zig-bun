import { describe, expect, test } from "bun:test";
import { parseCli, usage } from "../src/cli";

describe("parseCli", () => {
  test("parses search command and routes trailing tokens into query", () => {
    const parsed = parseCli(["search", "hello", "world", "--json"]);
    expect(parsed.command).toBe("search");
    expect(parsed.query).toBe("hello world --json");
  });

  test("defaults to interactive routing when no command is provided", () => {
    const parsed = parseCli(["--limit", "7"]);
    expect(parsed.command).toBe("interactive");
    expect(parsed.limit).toBe(7);
  });

  test("routes unknown command tokens to interactive mode", () => {
    const parsed = parseCli(["nonsense", "value"]);
    expect(parsed.command).toBe("interactive");
    expect(parsed.query).toBeUndefined();
  });

  test("normalizes invalid limits", () => {
    const parsed = parseCli(["grep", "q", "--limit", "0"]);
    expect(parsed.command).toBe("grep");
    expect(parsed.limit).toBe(50);
  });

  test("help flag routes command to help when parsed before command", () => {
    const parsed = parseCli(["--help", "search", "x"]);
    expect(parsed.help).toBe(true);
    expect(parsed.command).toBe("help");
  });

  test("throws error for unknown flag", () => {
    expect(() => parseCli(["--unknown"])).toThrow("Unknown flag: --unknown");
  });

  test("throws error when -p/--print is missing value", () => {
    expect(() => parseCli(["-p"])).toThrow("Missing value for -p");
    expect(() => parseCli(["--print"])).toThrow("Missing value for --print");
  });

  test("throws error when -c/--cwd is missing value", () => {
    expect(() => parseCli(["-c"])).toThrow("Missing value for -c");
    expect(() => parseCli(["--cwd"])).toThrow("Missing value for --cwd");
  });

  test("throws error when -l/--limit is missing value", () => {
    expect(() => parseCli(["-l"])).toThrow("Missing value for -l");
    expect(() => parseCli(["--limit"])).toThrow("Missing value for --limit");
  });

  test("throws error when -r/--root-session is missing value", () => {
    expect(() => parseCli(["-r"])).toThrow("Missing value for -r");
    expect(() => parseCli(["--root-session"])).toThrow("Missing value for --root-session");
  });
});

describe("usage", () => {
  test("returns usage help text containing standard sections", () => {
    const helpText = usage();
    expect(typeof helpText).toBe("string");
    expect(helpText).toContain("Usage:");
    expect(helpText).toContain("Commands:");
    expect(helpText).toContain("Flags:");
    expect(helpText).toContain("Interactive mode (default):");
  });
});
