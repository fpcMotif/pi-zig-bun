import { describe, expect, it } from "bun:test";
import { parseCli, usage } from "../src/cli";

describe("parseCli", () => {
  it("parses command + query + flags", () => {
    const parsed = parseCli(["--json", "--limit", "10", "--cwd", "/tmp", "search", "hello", "world"]);
    expect(parsed.command).toBe("search");
    expect(parsed.query).toBe("hello world");
    expect(parsed.json).toBeTrue();
    expect(parsed.limit).toBe(10);
    expect(parsed.cwd).toBe("/tmp");
  });

  it("defaults invalid limits to 50", () => {
    const parsed = parseCli(["grep", "needle", "--limit", "-2"]);
    expect(parsed.limit).toBe(50);
  });

  it("supports root session and help override", () => {
    const parsed = parseCli(["--help", "--root-session", "abc", "search", "q"]);
    expect(parsed.command).toBe("help");
    expect(parsed.rootSession).toBe("abc");
  });

  it("falls back to interactive when no command provided", () => {
    const parsed = parseCli(["--json"]);
    expect(parsed.command).toBe("interactive");
    expect(parsed.query).toBeUndefined();
  });

  it("throws when value flags are missing", () => {
    expect(() => parseCli(["--cwd"])).toThrow("Missing value for --cwd");
    expect(() => parseCli(["--limit"])).toThrow("Missing value for --limit");
  });
});

describe("usage", () => {
  it("includes key commands and flags", () => {
    const text = usage();
    expect(text).toContain("search <query>");
    expect(text).toContain("-j, --json");
    expect(text).toContain("/quit");
  });
});
