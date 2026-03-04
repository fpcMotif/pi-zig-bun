import { describe, expect, test } from "bun:test";
import { CapabilityManager } from "../src/permissions";

describe("CapabilityManager glob and transitions", () => {
  test("supports single-star and double-star semantics", () => {
    const manager = new CapabilityManager({
      "fs.read": ["src/*.ts", "tests/**"],
    });

    expect(manager.can("fs.read", "src/main.ts")).toBe(true);
    expect(manager.can("fs.read", "src/nested/main.ts")).toBe(false);
    expect(manager.can("fs.read", "tests/unit/a.test.ts")).toBe(true);
    expect(manager.can("fs.read", "README.md")).toBe(false);
  });

  test("deny-by-default then allow transitions via policy updates", () => {
    const manager = new CapabilityManager();
    expect(manager.can("fs.write", "tmp/out.txt")).toBe(false);

    manager.updateFromMap({ "fs.write": ["tmp/**"] });
    expect(manager.can("fs.write", "tmp/out.txt")).toBe(true);

    manager.updateFromMap({ "fs.write": undefined });
    expect(manager.can("fs.write", "tmp/out.txt")).toBe(false);
  });

  test("allowAll unlocks all capabilities", () => {
    const manager = new CapabilityManager({ "session.access": [] });
    manager.allowAll();
    expect(manager.can("session.access")).toBe(true);
    expect(manager.can("net.http", "https://example.com")).toBe(true);
  });
});
