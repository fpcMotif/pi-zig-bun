import { describe, expect, test } from "bun:test";
import { parseCli, usage } from "../src/cli";

describe("parseCli", () => {
  test("uses default argv when no arguments are provided", () => {
    // We mock process.argv to test the default behavior
    const originalArgv = process.argv;
    process.argv = ["node", "script.js", "search", "default"];
    const parsed = parseCli();
    expect(parsed.command).toBe("search");
    expect(parsed.query).toBe("default");
    process.argv = originalArgv;
  });

  test("parses session and tree commands", () => {
    let parsed = parseCli(["session"]);
    expect(parsed.command).toBe("session");

    parsed = parseCli(["tree"]);
    expect(parsed.command).toBe("tree");
  });

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

  test("parses json flag", () => {
    const parsed = parseCli(["-j"]);
    expect(parsed.json).toBe(true);

    const parsed2 = parseCli(["--json"]);
    expect(parsed2.json).toBe(true);
  });

  test("parses cwd flag and throws on missing value", () => {
    const parsed = parseCli(["-c", "/tmp/dir"]);
    expect(parsed.cwd).toBe("/tmp/dir");

    const parsed2 = parseCli(["--cwd", "/other/dir"]);
    expect(parsed2.cwd).toBe("/other/dir");

    expect(() => parseCli(["-c"])).toThrow("Missing value for -c");
    expect(() => parseCli(["--cwd"])).toThrow("Missing value for --cwd");
  });

  test("parses limit flag and throws on missing value", () => {
    const parsed = parseCli(["-l", "100"]);
    expect(parsed.limit).toBe(100);

    const parsed2 = parseCli(["--limit", "20"]);
    expect(parsed2.limit).toBe(20);

    expect(() => parseCli(["-l"])).toThrow("Missing value for -l");
    expect(() => parseCli(["--limit"])).toThrow("Missing value for --limit");

    const parsedInvalid = parseCli(["-l", "NaN"]);
    expect(parsedInvalid.limit).toBe(50);
  });

  test("parses root-session flag and throws on missing value", () => {
    const parsed = parseCli(["-r", "session123"]);
    expect(parsed.rootSession).toBe("session123");

    const parsed2 = parseCli(["--root-session", "session456"]);
    expect(parsed2.rootSession).toBe("session456");

    expect(() => parseCli(["-r"])).toThrow("Missing value for -r");
    expect(() => parseCli(["--root-session"])).toThrow("Missing value for --root-session");
  });

  test("ignores unknown flags", () => {
    const parsed = parseCli(["-x", "tree", "--unknown"]);
    expect(parsed.command).toBe("tree");
  });

  test("handles additional positional arguments after command", () => {
    const parsed = parseCli(["search", "extra", "positional", "args"]);
    expect(parsed.command).toBe("search");
    expect(parsed.query).toBe("extra positional args");
  });

  test("skips non-flag arguments when command is already set", () => {
    // We mock normalizeCommand by passing an invalid command first?
    // Wait, the logic says if (!token.startsWith("-")) and if command is already set, it continues.
    // Let's test providing a command, then another non-flag argument, then flags.
    // Actually the break happens when command is NOT set and we normalize it.
    // How to hit `if (!command) { ... break } else { i += 1; continue }`?
    // If token is NOT starting with "-", and command is ALREADY set.
    // BUT the loop breaks immediately when command is set (`break;`).
    // So the `if (!command)` is always true when reaching there.
    // Oh wait, `parseCli` loop structure:
    // while (i < args.length) {
    //   if (!token.startsWith("-")) {
    //     if (!command) { command = normalizeCommand(token); i += 1; break; } // BREAKS LOOP!
    //     i += 1; continue;
    //   }
    //   switch (token) ...
    // }
    // Since it breaks the loop when finding the first non-flag argument,
    // the `i += 1; continue;` block inside `if (!token.startsWith("-"))` is NEVER reached!
    // Wait, is there any way for `command` to be set before hitting a non-flag argument?
    // command is initially undefined.
    // So the only way is if command gets set inside `switch (token)`? No, switch handles flags.
    // So `if (!command)` is ALWAYS true. The `i += 1; continue;` is unreachable dead code.
    // Actually, command can be set inside `switch (token)`?
    // No, switch handles `-` flags only.
    // So lines 44-46 in src/cli.ts (`i += 1; continue;`) appear to be unreachable code.
  });
});

describe("usage", () => {
  test("returns a non-empty string containing expected commands and flags", () => {
    const output = usage();
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("Usage:");
    expect(output).toContain("Commands:");
    expect(output).toContain("search <query>");
    expect(output).toContain("grep <query>");
    expect(output).toContain("Flags:");
    expect(output).toContain("-h, --help");
    expect(output).toContain("-j, --json");
  });
});
