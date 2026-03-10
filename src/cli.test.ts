import { describe, expect, test } from "bun:test";
import { parseCli } from "./cli";

describe("parseCli", () => {
  test("parses search command", () => {
    const parsed = parseCli(["search", "hello", "world"]);
    expect(parsed.command).toBe("search");
    expect(parsed.query).toBe("hello world");
  });

  test("parses grep command", () => {
    const parsed = parseCli(["grep", "needle"]);
    expect(parsed.command).toBe("grep");
    expect(parsed.query).toBe("needle");
  });

  test("parses tree command", () => {
    const parsed = parseCli(["tree"]);
    expect(parsed.command).toBe("tree");
  });

  test("parses session alias command", () => {
    const parsed = parseCli(["session", "--root-session", "abc123"]);
    expect(parsed.command).toBe("session");
    expect(parsed.rootSession).toBe("abc123");
  });

  test("parses /login command alias", () => {
    const parsed = parseCli(["/login"]);
    expect(parsed.command).toBe("login");
  });

  test("parses -p one-shot mode", () => {
    const parsed = parseCli(["-p", "quick query"]);
    expect(parsed.command).toBe("search");
    expect(parsed.query).toBe("quick query");
  });

  test("parses --json one-shot mode", () => {
    const parsed = parseCli(["--json", "quick query"]);
    expect(parsed.command).toBe("search");
    expect(parsed.query).toBe("quick query");
    expect(parsed.json).toBeTrue();
  });

  test("reports unknown slash command", () => {
    const parsed = parseCli(["/wat"]);
    expect(parsed.parseError).toBe("Unknown command: /wat");
  });

  test("reports unknown flags", () => {
    const parsed = parseCli(["--wat"]);
    expect(parsed.parseError).toBe("Unknown flag: --wat");
  });

  test("throws for missing -p argument", () => {
    expect(() => parseCli(["-p"])).toThrow("Missing value for -p");
  });

  test("throws for missing --root-session argument", () => {
    expect(() => parseCli(["session", "--root-session"])).toThrow("Missing value for --root-session");
  });
});
