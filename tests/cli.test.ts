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
});

describe("usage", () => {
  test("returns a formatted help string", () => {
    const output = usage();
    expect(typeof output).toBe("string");
    expect(output).toContain("Usage:");
    expect(output).toContain("Commands:");
    expect(output).toContain("Flags:");
    expect(output).toContain("Interactive mode (default):");
  });
});
