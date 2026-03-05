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

describe("CapabilityManager core methods", () => {
  test("CapabilityManager.All contains wildcard for all capabilities", () => {
    expect(CapabilityManager.All).toEqual({
      "fs.read": "*",
      "fs.write": "*",
      "fs.execute": "*",
      "net.http": "*",
      "session.access": "*",
    });
  });

  test("can() edge cases", () => {
    const manager = new CapabilityManager({
      "fs.read": ["src/**"],
      "session.access": ["*"],
    });

    // session.access does not strictly require a target, but it only succeeds if policy is "*".
    // If target is undefined and policy is an array, it fails.
    const wildcardManagerSession = new CapabilityManager({ "session.access": "*" });
    expect(wildcardManagerSession.can("session.access")).toBe(true);

    // capabilities other than session.access require a target
    expect(manager.can("fs.read")).toBe(false);

    // undefined policy for a capability returns false
    expect(manager.can("fs.write", "src/main.ts")).toBe(false);

    // undefined target for a capability that requires one, even if policy is *
    const wildcardManager = new CapabilityManager({ "fs.read": "*" });
    expect(wildcardManager.can("fs.read")).toBe(false);
  });

  test("require() throws on denied and succeeds on allowed", () => {
    const manager = new CapabilityManager({
      "fs.read": ["src/**"],
    });

    // Allowed capability
    expect(() => manager.require("fs.read", "src/main.ts")).not.toThrow();

    // Denied capability - wrong target
    expect(() => manager.require("fs.read", "tests/a.test.ts")).toThrow("Capability denied: fs.read (tests/a.test.ts)");

    // Denied capability - missing target
    expect(() => manager.require("fs.read")).toThrow("Capability denied: fs.read");

    // Denied capability - undefined policy
    expect(() => manager.require("fs.write", "src/main.ts")).toThrow("Capability denied: fs.write (src/main.ts)");
  });

  test("updateFromMap() merges policies", () => {
    const manager = new CapabilityManager({
      "fs.read": ["src/**"],
    });

    manager.updateFromMap({
      "fs.write": ["dist/**"],
      "fs.read": ["tests/**"], // overwrites previous fs.read
    });

    expect(manager.can("fs.read", "src/main.ts")).toBe(false); // Overwritten
    expect(manager.can("fs.read", "tests/a.test.ts")).toBe(true);
    expect(manager.can("fs.write", "dist/main.js")).toBe(true);
  });

  test("snapshot() returns a correct copy of the internal policy", () => {
    const initialPolicy = {
      "fs.read": ["src/**"],
    };
    const manager = new CapabilityManager(initialPolicy);

    const snapshot = manager.snapshot();
    expect(snapshot).toEqual(initialPolicy);

    // Modifying the snapshot shouldn't affect the manager's internal state
    snapshot["fs.read"] = ["*"];
    expect(manager.can("fs.read", "outside/file.ts")).toBe(false);

    // Modifying manager shouldn't affect existing snapshot
    manager.updateFromMap({ "fs.write": ["*"] });
    expect(snapshot["fs.write"]).toBeUndefined();
  });
});
