import { describe, expect, test } from "bun:test";
import { CapabilityManager } from "../src/permissions";

describe("CapabilityManager glob and allow/deny behavior", () => {
  test("denies by default and requires explicit path for file capabilities", () => {
    const manager = new CapabilityManager();
    expect(manager.can("fs.read", "/workspace/file.txt")).toBe(false);
    expect(manager.can("fs.read")).toBe(false);
    expect(manager.can("session.access")).toBe(false);
  });

  test("matches *, ** and ? glob style patterns", () => {
    const manager = new CapabilityManager({
      "fs.read": ["src/*.ts", "src/**/*.ts", "README.?d"],
      "session.access": ["session-?"],
    });

    expect(manager.can("fs.read", "src/main.ts")).toBe(true);
    expect(manager.can("fs.read", "src/nested/value.ts")).toBe(true);
    expect(manager.can("fs.read", "README.md")).toBe(true);
    expect(manager.can("fs.read", "README.mdx")).toBe(false);
    expect(manager.can("session.access", "session-a")).toBe(true);
    expect(manager.can("session.access", "session-aa")).toBe(false);
  });

  test("normalizes windows separators before matching", () => {
    const manager = new CapabilityManager({ "fs.write": ["src/**/*.ts"] });
    expect(manager.can("fs.write", "src\\nested\\index.ts")).toBe(true);
  });

  test("allowAll and updateFromMap adjust effective policy", () => {
    const manager = new CapabilityManager({ "fs.read": ["src/*.ts"] });
    expect(manager.can("fs.read", "docs/a.md")).toBe(false);

    manager.allowAll();
    expect(manager.can("fs.read", "docs/a.md")).toBe(true);

    manager.updateFromMap({ "fs.read": ["docs/*.md"] });
    expect(manager.can("fs.read", "docs/a.md")).toBe(true);
    expect(manager.can("fs.read", "src/main.ts")).toBe(false);
  });

  test("throws on denied require calls", () => {
    const manager = new CapabilityManager({ "net.http": ["api.example.com"] });
    expect(() => manager.require("net.http", "unauthorized.example.com")).toThrow("Capability denied");
  });
});
